import { CryptoHasher } from "bun";

import { latestVersionSchema, updateApiResponseSchema, type LatestVersion } from "../schemas";
import {
  Architecture,
  type Architecture as ArchitectureDescriptor,
  type ArchitectureValues,
} from "./architecture";
import type { ChannelConfig } from "./channels";

const USER_AGENT = "aur-cursor-bin-updater/1.0";

export type CursorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type UnavailableArtifact = {
  url: string;
  reason: string;
};

type ReportedUnavailableArtifact = UnavailableArtifact & {
  architecture: ArchitectureDescriptor;
};

type NonEmptyArray<Value> = readonly [Value, ...Value[]];
type ArchitectureReleases = ArchitectureValues<LatestVersion | null>;
type ArtifactChecks = ArchitectureValues<UnavailableArtifact | null>;

const latestReleaseBrand = Symbol("LatestRelease");
interface LatestReleaseBrand {
  readonly [latestReleaseBrand]: true;
}

type LatestReleaseState =
  | {
      status: "available";
      latest: LatestVersion;
      releases: ArchitectureValues<LatestVersion>;
    }
  | {
      status: "unavailable";
      releases: ArchitectureValues<null>;
    }
  | {
      status: "architecture-mismatch";
      releases: ArchitectureReleases;
    }
  | {
      status: "artifact-unavailable";
      latest: LatestVersion;
      releases: ArchitectureValues<LatestVersion>;
      artifacts: NonEmptyArray<ReportedUnavailableArtifact>;
    };

export type LatestRelease = LatestReleaseState & LatestReleaseBrand;

const brandValue: true = true;

function brandLatestRelease<State extends LatestReleaseState>(
  state: State,
): State & LatestReleaseBrand {
  return Object.assign(state, { [latestReleaseBrand]: brandValue });
}

export const LatestRelease = {
  fromArchitectureResults(
    releases: ArchitectureReleases,
    artifactChecks: ArtifactChecks,
  ): LatestRelease {
    const x86_64 = releases.x86_64;
    const aarch64 = releases.aarch64;
    if (x86_64 === null && aarch64 === null) {
      return brandLatestRelease({
        status: "unavailable",
        releases: { x86_64: null, aarch64: null },
      });
    }
    if (
      x86_64 === null ||
      aarch64 === null ||
      x86_64.upstreamPkgver !== aarch64.upstreamPkgver ||
      x86_64.commit !== aarch64.commit
    ) {
      return brandLatestRelease({
        status: "architecture-mismatch",
        releases,
      });
    }

    const alignedReleases = { x86_64, aarch64 };
    const unavailableArtifacts = Architecture.all.flatMap((architecture) => {
      const artifact = artifactChecks[architecture.pkgbuild];
      return artifact ? [{ architecture, ...artifact }] : [];
    });
    const [firstUnavailableArtifact, ...remainingUnavailableArtifacts] =
      unavailableArtifacts;
    if (firstUnavailableArtifact) {
      return brandLatestRelease({
        status: "artifact-unavailable",
        latest: x86_64,
        releases: alignedReleases,
        artifacts: [
          firstUnavailableArtifact,
          ...remainingUnavailableArtifacts,
        ],
      });
    }

    return brandLatestRelease({
      status: "available",
      latest: x86_64,
      releases: alignedReleases,
    });
  },
  message(release: LatestRelease) {
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

const defaultFetch: CursorFetch = (input, init) => fetch(input, init);

function extractCommitFromDownloadUrl(downloadUrl: string) {
  const pathname = new URL(downloadUrl).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const productionIndex = segments.indexOf("production");
  if (productionIndex < 0) return "";
  return segments[productionIndex + 1] ?? "";
}

export function createDebUrl(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
) {
  return `https://downloads.cursor.com/production/${latest.commit}/linux/${architecture.cursorPlatform}/deb/${architecture.deb}/deb/cursor_${latest.upstreamPkgver}_${architecture.deb}.deb`;
}

async function digestStream(
  stream: ReadableStream<Uint8Array>,
  hash: CryptoHasher,
): Promise<string> {
  for await (const value of stream) {
    hash.update(value);
  }
  return hash.digest("hex");
}

async function getLatestVersion(
  channel: ChannelConfig,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch,
) {
  const machineHashPlaceholder = "deadbeef";
  const probePkgver = "0.0.0";
  const updateUrl = `https://api2.cursor.sh/updates/api/update/${architecture.updatePlatform}/cursor/${probePkgver}/${machineHashPlaceholder}/${channel.releaseTrack}`;

  const response = await fetcher(updateUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 204) return null;
  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`Unexpected API status ${response.status}: ${text}`);
  }

  const payload = updateApiResponseSchema.parse(await response.json());
  const commit = extractCommitFromDownloadUrl(payload.url);
  if (!commit) throw new Error("Could not parse commit from update API URL");

  return latestVersionSchema.parse({
    upstreamPkgver: payload.version,
    pkgver: payload.version.split("-").join("_"),
    commit,
    downloadUrl: payload.url,
  });
}

async function checkDebAvailability(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch,
): Promise<UnavailableArtifact | null> {
  const url = createDebUrl(latest, architecture);

  try {
    const response = await fetcher(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok
      ? null
      : {
          url,
          reason: `HTTP ${response.status}`,
        };
  } catch (error: unknown) {
    return {
      url,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getLatestRelease(
  channel: ChannelConfig,
  fetcher: CursorFetch = defaultFetch,
): Promise<LatestRelease> {
  const releases = await Architecture.mapValues(
    async (architecture) =>
      await getLatestVersion(channel, architecture, fetcher),
  );
  const metadataRelease = LatestRelease.fromArchitectureResults(releases, {
    x86_64: null,
    aarch64: null,
  });
  if (metadataRelease.status !== "available") return metadataRelease;

  const artifactChecks = await Architecture.mapValues(
    async (architecture) =>
      await checkDebAvailability(metadataRelease.latest, architecture, fetcher),
  );

  return LatestRelease.fromArchitectureResults(releases, artifactChecks);
}

export async function computeDebSha512(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch = defaultFetch,
) {
  const response = await fetcher(createDebUrl(latest, architecture), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);

  const hash = new CryptoHasher("sha512");
  return digestStream(response.body, hash);
}
