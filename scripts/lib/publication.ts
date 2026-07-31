import type {
  CurrentVersion,
  PublicationStatus as PublicationStatusValue,
} from "../schemas";
import type { LatestRelease } from "./cursor-api";

export const PublicationStatus = {
  fromRelease(
    current: CurrentVersion,
    release: LatestRelease,
  ): PublicationStatusValue {
    switch (release.status) {
      case "available":
        return current.upstreamPkgver !== release.latest.upstreamPkgver ||
          current.commit !== release.latest.commit
          ? "update-available"
          : "up-to-date";
      case "unavailable":
        return "release-unavailable";
      case "architecture-mismatch":
        return "architecture-mismatch";
      case "artifact-unavailable":
        return "artifact-unavailable";
    }
  },
} as const;
