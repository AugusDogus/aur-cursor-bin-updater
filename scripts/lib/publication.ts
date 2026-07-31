import type {
  CurrentVersion,
  LatestVersion,
  PublicationDecision as PublicationDecisionValue,
} from "../schemas";
import {
  LatestRelease,
  type LatestRelease as LatestReleaseValue,
} from "./cursor-api";

type NonUpdatePublicationDecision = Exclude<
  PublicationDecisionValue,
  { status: "update-available" }
>;

export type PublicationPlan =
  | {
      status: "skip";
      publication: NonUpdatePublicationDecision;
    }
  | {
      status: "publish-current";
      package: ReturnType<typeof summarizeVersion>;
    }
  | {
      status: "update-and-publish";
      latest: LatestVersion;
      package: ReturnType<typeof summarizeVersion>;
    };

function summarizeVersion(
  version: Pick<CurrentVersion, "pkgver" | "upstreamPkgver" | "commit">,
) {
  return {
    pkgver: version.pkgver,
    upstream_pkgver: version.upstreamPkgver,
    commit: version.commit,
  };
}

export const PublicationDecision = {
  fromRelease(
    current: CurrentVersion,
    release: LatestReleaseValue,
  ): PublicationDecisionValue {
    switch (release.status) {
      case "available":
        return current.upstreamPkgver !== release.latest.upstreamPkgver ||
          current.commit !== release.latest.commit
          ? {
              status: "update-available",
              latest: summarizeVersion(release.latest),
            }
          : { status: "up-to-date" };
      case "unavailable":
        return {
          status: "release-unavailable",
          message: LatestRelease.message(release),
        };
      case "architecture-mismatch":
        return {
          status: "architecture-mismatch",
          message: LatestRelease.message(release),
        };
      case "artifact-unavailable":
        return {
          status: "artifact-unavailable",
          message: LatestRelease.message(release),
        };
    }
  },
} as const;

export const PublicationPlan = {
  fromRelease(
    current: CurrentVersion,
    release: LatestReleaseValue,
    forcePublish: boolean,
  ): PublicationPlan {
    if (forcePublish) {
      return {
        status: "publish-current",
        package: summarizeVersion(current),
      };
    }

    const publication = PublicationDecision.fromRelease(current, release);
    if (publication.status !== "update-available") {
      return { status: "skip", publication };
    }
    if (release.status !== "available") {
      throw new Error(
        "Publication decision is inconsistent: an update requires an available release",
      );
    }
    return {
      status: "update-and-publish",
      latest: release.latest,
      package: summarizeVersion(release.latest),
    };
  },
} as const;
