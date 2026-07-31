import type { LatestVersion } from "../schemas";
import { checkResultSchema, preparationResultSchema } from "../schemas";
import { Architecture } from "./architecture";
import { isAurPackageCurrent } from "./aur";
import { getChannelConfig, getChannelTarget } from "./channels";
import type { CliCommand } from "./cli";
import { computeDebSha512 } from "./cursor-artifact";
import { getLatestRelease } from "./cursor-api";
import {
  generateSrcinfo,
  parseCurrentVersion,
  updatePkgbuild,
} from "./pkgbuild";
import {
  PublicationPlan,
  type PublicationPlan as PublicationPlanValue,
} from "./publication";
import { Release } from "./release";

export interface UpdateDependencies {
  getLatestRelease: typeof getLatestRelease;
  computeDebSha512: typeof computeDebSha512;
  isAurPackageCurrent: typeof isAurPackageCurrent;
}

const defaultDependencies: UpdateDependencies = {
  getLatestRelease,
  computeDebSha512,
  isAurPackageCurrent,
};

type CheckCommand = Extract<CliCommand, { mode: "check" }>;
type PrepareCommand = Extract<CliCommand, { mode: "prepare" }>;
type UpdateCommand = Extract<CliCommand, { mode: "update" }>;
type SrcinfoCommand = Extract<CliCommand, { mode: "srcinfo" }>;

async function applyLatestVersion(
  command: PrepareCommand | UpdateCommand,
  latest: LatestVersion,
  dependencies: UpdateDependencies,
) {
  const checksums = await Architecture.mapValues(
    async (architecture) =>
      command.skipChecksum
        ? "SKIP"
        : await dependencies.computeDebSha512(latest, architecture),
  );
  await updatePkgbuild(command.pkgbuildPath, latest, checksums);
}

export async function checkForUpdate(
  command: CheckCommand,
  dependencies: UpdateDependencies = defaultDependencies,
) {
  const current = await parseCurrentVersion(command.pkgbuildPath);
  const release = await dependencies.getLatestRelease(
    getChannelConfig(command.channel),
  );
  const plan = PublicationPlan.fromRelease(current, release);
  return checkResultSchema.parse({
    channel: command.channel,
    current: {
      pkgver: current.pkgver,
      upstream_pkgver: current.upstreamPkgver,
      commit: current.commit,
    },
    publication: PublicationPlan.toDecision(plan),
  });
}

export async function preparePublication(
  command: PrepareCommand,
  dependencies: UpdateDependencies = defaultDependencies,
) {
  const current = await parseCurrentVersion(command.pkgbuildPath);
  const target = getChannelTarget(command.channel);
  if (command.forcePublish) {
    return preparationResultSchema.parse({
      target,
      plan: PublicationPlan.toDto(PublicationPlan.publishCurrent(current)),
    });
  }

  const release = await dependencies.getLatestRelease(
    getChannelConfig(command.channel),
  );
  let plan: PublicationPlanValue = PublicationPlan.fromRelease(
    current,
    release,
  );
  if (
    plan.status === "skip" &&
    !(await dependencies.isAurPackageCurrent(target))
  ) {
    plan = PublicationPlan.publishCurrent(current);
  }
  if (plan.status === "update-and-publish") {
    await applyLatestVersion(command, plan.latest, dependencies);
  }
  return preparationResultSchema.parse({
    target,
    plan: PublicationPlan.toDto(plan),
  });
}

export type UpdateResult =
  | {
      status: "updated";
      latest: LatestVersion;
    }
  | {
      status: "not-updated";
      message: string;
    };

export async function updatePackage(
  command: UpdateCommand,
  dependencies: UpdateDependencies = defaultDependencies,
): Promise<UpdateResult> {
  const current = await parseCurrentVersion(command.pkgbuildPath);
  const release = await dependencies.getLatestRelease(
    getChannelConfig(command.channel),
  );
  const plan = PublicationPlan.fromRelease(current, release);
  if (plan.status === "skip") {
    return {
      status: "not-updated",
      message:
        release.status === "available"
          ? "Already up to date."
          : Release.message(release),
    };
  }
  await applyLatestVersion(command, plan.latest, dependencies);
  return { status: "updated", latest: plan.latest };
}

export async function generateChannelSrcinfo(command: SrcinfoCommand) {
  return generateSrcinfo(command.pkgbuildPath);
}
