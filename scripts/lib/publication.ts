import type {
  CurrentVersion,
  LatestVersion,
  PreparationPlanDto,
  PublicationDecision,
} from "../schemas";
import { Release, type Release as ReleaseValue } from "./release";

type NonUpdatePublicationDecision = Exclude<
  PublicationDecision,
  { status: "update-available" }
>;

export type PublicationPlan =
  | {
      status: "skip";
      publication: NonUpdatePublicationDecision;
    }
  | {
      status: "publish-current";
      current: CurrentVersion;
    }
  | {
      status: "update-and-publish";
      latest: LatestVersion;
    };

export type ReleasePublicationPlan = Exclude<
  PublicationPlan,
  { status: "publish-current" }
>;

function summarizeVersion(
  version: Pick<CurrentVersion, "pkgver" | "upstreamPkgver" | "commit">,
) {
  return {
    pkgver: version.pkgver,
    upstream_pkgver: version.upstreamPkgver,
    commit: version.commit,
  };
}

function unreachable(value: never): never {
  throw new Error(`Unhandled publication plan: ${JSON.stringify(value)}`);
}

export const PublicationPlan = {
  fromRelease(
    current: CurrentVersion,
    release: ReleaseValue,
  ): ReleasePublicationPlan {
    switch (release.status) {
      case "available":
        return current.upstreamPkgver !== release.latest.upstreamPkgver ||
          current.commit !== release.latest.commit
          ? {
              status: "update-and-publish",
              latest: release.latest,
            }
          : {
              status: "skip",
              publication: { status: "up-to-date" },
            };
      case "unavailable":
        return {
          status: "skip",
          publication: {
            status: "release-unavailable",
            message: Release.message(release),
          },
        };
      case "architecture-mismatch":
        return {
          status: "skip",
          publication: {
            status: "architecture-mismatch",
            message: Release.message(release),
          },
        };
      case "artifact-unavailable":
        return {
          status: "skip",
          publication: {
            status: "artifact-unavailable",
            message: Release.message(release),
          },
        };
    }
  },
  publishCurrent(current: CurrentVersion): PublicationPlan {
    return { status: "publish-current", current };
  },
  toDecision(plan: ReleasePublicationPlan): PublicationDecision {
    switch (plan.status) {
      case "skip":
        return plan.publication;
      case "update-and-publish":
        return {
          status: "update-available",
          latest: summarizeVersion(plan.latest),
        };
      default:
        return unreachable(plan);
    }
  },
  toDto(plan: PublicationPlan): PreparationPlanDto {
    switch (plan.status) {
      case "skip":
        return {
          status: "skip",
          publication: plan.publication,
        };
      case "publish-current":
        return {
          status: "publish-current",
          package: summarizeVersion(plan.current),
        };
      case "update-and-publish":
        return {
          status: "update-and-publish",
          package: summarizeVersion(plan.latest),
        };
      default:
        return unreachable(plan);
    }
  },
} as const;
