import type { LatestVersion } from "../schemas";
import {
  Architecture,
  type Architecture as ArchitectureDescriptor,
  type ArchitectureValues,
} from "./architecture";

export type ArtifactAvailability =
  | { status: "available" }
  | {
      status: "unavailable";
      url: string;
      reason: string;
    };

type ReportedUnavailableArtifact = {
  architecture: ArchitectureDescriptor;
  url: string;
  reason: string;
};
type NonEmptyArray<Value> = readonly [Value, ...Value[]];
type ArchitectureReleases = ArchitectureValues<LatestVersion | null>;

const releaseBrand = Symbol("Release");
interface ReleaseBrand {
  readonly [releaseBrand]: true;
}

type ReleaseState =
  | {
      status: "available";
      latest: LatestVersion;
    }
  | {
      status: "unavailable";
    }
  | {
      status: "architecture-mismatch";
      releases: ArchitectureReleases;
    }
  | {
      status: "artifact-unavailable";
      latest: LatestVersion;
      artifacts: NonEmptyArray<ReportedUnavailableArtifact>;
    };

export type Release = ReleaseState & ReleaseBrand;
export type ReleaseAlignment =
  | Extract<Release, { status: "unavailable" | "architecture-mismatch" }>
  | {
      status: "aligned";
      latest: LatestVersion;
    };

const brandValue: true = true;

function brand<State extends ReleaseState>(
  state: State,
): State & ReleaseBrand {
  return Object.assign(state, { [releaseBrand]: brandValue });
}

export const Release = {
  align(releases: ArchitectureReleases): ReleaseAlignment {
    const x86_64 = releases.x86_64;
    const aarch64 = releases.aarch64;
    if (x86_64 === null && aarch64 === null) {
      return brand({ status: "unavailable" });
    }
    if (
      x86_64 === null ||
      aarch64 === null ||
      x86_64.upstreamPkgver !== aarch64.upstreamPkgver ||
      x86_64.pkgver !== aarch64.pkgver ||
      x86_64.commit !== aarch64.commit
    ) {
      return brand({
        status: "architecture-mismatch",
        releases,
      });
    }
    return { status: "aligned", latest: x86_64 };
  },
  afterArtifactChecks(
    alignment: Extract<ReleaseAlignment, { status: "aligned" }>,
    artifactChecks: ArchitectureValues<ArtifactAvailability>,
  ): Release {
    const unavailableArtifacts = Architecture.all.flatMap((architecture) => {
      const artifact = artifactChecks[architecture.pkgbuild];
      return artifact.status === "unavailable"
        ? [
            {
              architecture,
              url: artifact.url,
              reason: artifact.reason,
            },
          ]
        : [];
    });
    const [firstUnavailableArtifact, ...remainingUnavailableArtifacts] =
      unavailableArtifacts;
    if (firstUnavailableArtifact) {
      return brand({
        status: "artifact-unavailable",
        latest: alignment.latest,
        artifacts: [
          firstUnavailableArtifact,
          ...remainingUnavailableArtifacts,
        ],
      });
    }
    return brand({
      status: "available",
      latest: alignment.latest,
    });
  },
  message(release: Release) {
    switch (release.status) {
      case "available":
        return `Release ${release.latest.upstreamPkgver} is available for every supported architecture.`;
      case "unavailable":
        return "No update payload is available for any supported architecture.";
      case "architecture-mismatch":
        return `Architecture releases are not aligned: ${Architecture.all
          .map((architecture) => {
            const latest = release.releases[architecture.pkgbuild];
            return latest
              ? `${architecture.pkgbuild}=${latest.upstreamPkgver} (${latest.commit})`
              : `${architecture.pkgbuild}=unavailable`;
          })
          .join(", ")}. The current package remains unchanged.`;
      case "artifact-unavailable":
        return `Release ${release.latest.upstreamPkgver} is not ready for every architecture: ${release.artifacts
          .map(
            ({ architecture, reason }) =>
              `${architecture.pkgbuild} artifact failed availability check (${reason})`,
          )
          .join(", ")}. The current package remains unchanged.`;
    }
  },
} as const;
