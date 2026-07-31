import type {
  CurrentVersion,
  LatestVersion,
  PublicationDecision as PublicationDecisionValue,
} from "../schemas";
import { LatestRelease, type LatestRelease as LatestReleaseValue } from "./cursor-api";

function summarizeVersion(latest: LatestVersion) {
  return {
    pkgver: latest.pkgver,
    upstream_pkgver: latest.upstreamPkgver,
    commit: latest.commit,
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
