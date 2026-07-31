import type { LatestVersion } from "../schemas";
import { checkResultSchema, preparationResultSchema } from "../schemas";
import { Architecture } from "./architecture";
import { isAurPackageCurrent } from "./aur";
import { getChannelConfig } from "./channels";
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
  type PreparationObservation,
} from "./publication";
import { Release } from "./release";
import { summarizeVersion } from "./version";

export interface CheckDependencies {
  getLatestRelease: typeof getLatestRelease;
}

export interface PackageUpdateDependencies extends CheckDependencies {
  computeDebSha512: typeof computeDebSha512;
  updatePkgbuild: typeof updatePkgbuild;
}

export interface PrepareDependencies
  extends PackageUpdateDependencies {
  isAurPackageCurrent: typeof isAurPackageCurrent;
}

const defaultCheckDependencies: CheckDependencies = {
  getLatestRelease,
};

const defaultPackageUpdateDependencies: PackageUpdateDependencies = {
  getLatestRelease,
  computeDebSha512,
  updatePkgbuild,
};

const defaultPrepareDependencies: PrepareDependencies = {
  ...defaultPackageUpdateDependencies,
  isAurPackageCurrent,
};

type CheckCommand = Extract<CliCommand, { mode: "check" }>;
type PrepareCommand = Extract<CliCommand, { mode: "prepare" }>;
type UpdateCommand = Extract<CliCommand, { mode: "update" }>;
type SrcinfoCommand = Extract<CliCommand, { mode: "srcinfo" }>;

type Observation<Value> =
  | { status: "observed"; value: Value }
  | { status: "failed"; error: unknown };

async function observe<Value>(
  operation: () => Promise<Value>,
): Promise<Observation<Value>> {
  try {
    return { status: "observed", value: await operation() };
  } catch (error: unknown) {
    return { status: "failed", error };
  }
}

function throwObservationErrors(
  errors: readonly [unknown, ...unknown[]],
): never {
  const [first, ...remaining] = errors;
  if (remaining.length === 0) throw first;
  throw new AggregateError(
    errors,
    "AUR comparison and Cursor release discovery both failed",
  );
}

async function applyLatestVersion(
  command: PrepareCommand | UpdateCommand,
  latest: LatestVersion,
  dependencies: PackageUpdateDependencies,
) {
  const checksums = await Architecture.mapValues(
    async (architecture) =>
      command.mode === "update" && command.skipChecksum
        ? "SKIP"
        : await dependencies.computeDebSha512(latest, architecture),
  );
  const pkgbuildPath =
    command.mode === "prepare"
      ? command.target.pkgbuild_path
      : command.pkgbuildPath;
  await dependencies.updatePkgbuild(pkgbuildPath, latest, checksums);
}

export async function checkForUpdate(
  command: CheckCommand,
  dependencies: CheckDependencies = defaultCheckDependencies,
) {
  const current = await parseCurrentVersion(command.pkgbuildPath);
  const release = await dependencies.getLatestRelease(
    getChannelConfig(command.channel),
  );
  const plan = PublicationPlan.fromRelease(current, release);
  return checkResultSchema.parse({
    channel: command.channel,
    current: summarizeVersion(current),
    publication: PublicationPlan.toDecision(plan),
  });
}

export async function preparePublication(
  command: PrepareCommand,
  dependencies: PrepareDependencies = defaultPrepareDependencies,
) {
  const target = command.target;
  const current = await parseCurrentVersion(target.pkgbuild_path);
  let observation: PreparationObservation;
  if (command.forcePublish) observation = { status: "forced" };
  else {
    const [aur, release] = await Promise.all([
      observe(() => dependencies.isAurPackageCurrent(target)),
      observe(() =>
        dependencies.getLatestRelease(
          getChannelConfig(target.channel),
        ),
      ),
    ]);
    observation = {
      status: "observed",
      aur:
        aur.status === "failed"
          ? aur
          : aur.value
            ? { status: "current" }
            : { status: "drifted" },
      release,
    };
  }

  const outcome = PublicationPlan.prepare(current, observation);
  if (outcome.status === "failed") {
    throwObservationErrors(outcome.errors);
  }
  const plan = outcome.plan;
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
  dependencies: PackageUpdateDependencies =
    defaultPackageUpdateDependencies,
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

export async function generateCommandSrcinfo(command: SrcinfoCommand) {
  return generateSrcinfo(command.pkgbuildPath);
}
