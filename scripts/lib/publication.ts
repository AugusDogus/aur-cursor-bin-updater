import type {
  CurrentVersion,
  LatestVersion,
  PreparationPlanDto,
  PublicationDecision,
} from "../schemas";
import { Release, type Release as ReleaseValue } from "./release";
import { summarizeVersion } from "./version";

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

export type PreparationObservation =
  | { status: "forced" }
  | {
      status: "observed";
      aur:
        | { status: "current" }
        | { status: "drifted" }
        | { status: "failed"; error: unknown };
      release:
        | { status: "observed"; value: ReleaseValue }
        | { status: "failed"; error: unknown };
    };

export type PreparationOutcome =
  | { status: "planned"; plan: PublicationPlan }
  | {
      status: "failed";
      errors: readonly [unknown, ...unknown[]];
    };

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
  prepare(
    current: CurrentVersion,
    observation: PreparationObservation,
  ): PreparationOutcome {
    if (observation.status === "forced") {
      return {
        status: "planned",
        plan: PublicationPlan.publishCurrent(current),
      };
    }

    if (observation.release.status === "observed") {
      const releasePlan = PublicationPlan.fromRelease(
        current,
        observation.release.value,
      );
      if (releasePlan.status === "update-and-publish") {
        return { status: "planned", plan: releasePlan };
      }
      switch (observation.aur.status) {
        case "current":
          return { status: "planned", plan: releasePlan };
        case "drifted":
          return {
            status: "planned",
            plan: PublicationPlan.publishCurrent(current),
          };
        case "failed":
          return {
            status: "failed",
            errors: [observation.aur.error],
          };
      }
    }

    switch (observation.aur.status) {
      case "drifted":
        return {
          status: "planned",
          plan: PublicationPlan.publishCurrent(current),
        };
      case "current":
        return {
          status: "failed",
          errors: [observation.release.error],
        };
      case "failed":
        return {
          status: "failed",
          errors: [
            observation.release.error,
            observation.aur.error,
          ],
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
