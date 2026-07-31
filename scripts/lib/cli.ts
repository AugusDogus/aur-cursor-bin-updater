import { dirname } from "node:path";
import { Command } from "commander";

import {
  channelKeySchema,
  getChannelConfig,
  type ChannelKey,
} from "./channels";

const usage =
  "Usage: bun scripts/update.ts [--check|--update|--prepare|--srcinfo] --channel <nightly|early-access> [--pkgbuild <path>] [--srcinfo-path <path>] [--skip-checksum] [--force-publish]";

export interface CliOptions {
  mode: "check" | "update" | "prepare" | "srcinfo";
  channel: ChannelKey;
  pkgbuildPath: string;
  srcinfoPath: string;
  skipChecksum: boolean;
  forcePublish: boolean;
}

export function getUsageText() {
  return usage;
}

function parseChannel(rawChannel: string) {
  const parsed = channelKeySchema.safeParse(rawChannel);
  if (!parsed.success)
    throw new Error("Missing or invalid --channel (nightly|early-access)");
  return parsed.data;
}

function parseMode(options: {
  check?: boolean;
  update?: boolean;
  prepare?: boolean;
  srcinfo?: boolean;
}): CliOptions["mode"] {
  const selectedModes: CliOptions["mode"][] = [];
  if (options.check) selectedModes.push("check");
  if (options.update) selectedModes.push("update");
  if (options.prepare) selectedModes.push("prepare");
  if (options.srcinfo) selectedModes.push("srcinfo");

  if (selectedModes.length === 0) throw new Error(usage);
  if (selectedModes.length > 1) {
    throw new Error(
      "Choose exactly one mode: --check, --update, --prepare, or --srcinfo",
    );
  }

  const [mode] = selectedModes;
  if (mode === undefined) throw new Error(usage);
  return mode;
}

export function parseCliOptions(args: string[]): CliOptions {
  const program = new Command()
    .name("scripts/update.ts")
    .exitOverride()
    .allowExcessArguments(false)
    .option("--check", "Output update check JSON")
    .option("--update", "Update PKGBUILD in place")
    .option("--prepare", "Prepare a PKGBUILD and output its publication plan")
    .option("--srcinfo", "Generate .SRCINFO from PKGBUILD")
    .requiredOption("--channel <channel>", "nightly or early-access")
    .option("--pkgbuild <path>", "Path to PKGBUILD")
    .option("--srcinfo-path <path>", "Path to .SRCINFO output")
    .option("--skip-checksum", "Skip .deb checksum fetch when updating")
    .option("--force-publish", "Prepare the current PKGBUILD for publication");

  try {
    program.parse(args, { from: "user" });
  } catch {
    throw new Error(usage);
  }

  const options = program.opts<{
    check?: boolean;
    update?: boolean;
    prepare?: boolean;
    srcinfo?: boolean;
    channel: string;
    pkgbuild?: string;
    srcinfoPath?: string;
    skipChecksum?: boolean;
    forcePublish?: boolean;
  }>();
  const mode = parseMode(options);
  const channel = parseChannel(options.channel);
  const channelConfig = getChannelConfig(channel);
  if (mode === "prepare" && options.pkgbuild !== undefined) {
    throw new Error("--prepare uses the selected channel's canonical PKGBUILD");
  }
  if (options.srcinfoPath !== undefined && mode !== "srcinfo") {
    throw new Error("--srcinfo-path requires --srcinfo");
  }
  if (
    options.skipChecksum &&
    mode !== "update" &&
    mode !== "prepare"
  ) {
    throw new Error("--skip-checksum requires --update or --prepare");
  }
  const pkgbuildPath = options.pkgbuild ?? channelConfig.defaultPkgbuild;
  const srcinfoPath =
    options.srcinfoPath ?? `${dirname(pkgbuildPath)}/.SRCINFO`;
  const skipChecksum = options.skipChecksum ?? false;
  const forcePublish = options.forcePublish ?? false;
  if (forcePublish && mode !== "prepare") {
    throw new Error("--force-publish requires --prepare");
  }

  return {
    mode,
    channel,
    pkgbuildPath,
    srcinfoPath,
    skipChecksum,
    forcePublish,
  };
}
