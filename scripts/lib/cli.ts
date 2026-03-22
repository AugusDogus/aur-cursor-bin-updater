import { dirname } from "node:path";
import { Command } from "commander";

import { channelKeySchema, type ChannelKey } from "../schemas";
import { getChannelConfig } from "./channels";

const usage =
  "Usage: bun scripts/update.ts [--check|--update|--srcinfo] --channel <nightly|early-access> [--pkgbuild <path>] [--srcinfo-path <path>] [--skip-checksum]";

export interface CliOptions {
  mode: "check" | "update" | "srcinfo";
  channel: ChannelKey;
  pkgbuildPath: string;
  srcinfoPath: string;
  skipChecksum: boolean;
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

export function parseCliOptions(args: string[]): CliOptions {
  const program = new Command()
    .name("scripts/update.ts")
    .exitOverride()
    .allowExcessArguments(false)
    .option("--check", "Output update check JSON")
    .option("--update", "Update PKGBUILD in place")
    .option("--srcinfo", "Generate .SRCINFO from PKGBUILD")
    .requiredOption("--channel <channel>", "nightly or early-access")
    .option("--pkgbuild <path>", "Path to PKGBUILD")
    .option("--srcinfo-path <path>", "Path to .SRCINFO output")
    .option("--skip-checksum", "Skip .deb checksum fetch when updating");

  try {
    program.parse(args, { from: "user" });
  } catch {
    throw new Error(usage);
  }

  const options = program.opts<{
    check?: boolean;
    update?: boolean;
    srcinfo?: boolean;
    channel: string;
    pkgbuild?: string;
    srcinfoPath?: string;
    skipChecksum?: boolean;
  }>();
  const selectedModes = [
    options.check ? "check" : null,
    options.update ? "update" : null,
    options.srcinfo ? "srcinfo" : null,
  ].filter((value) => value !== null);
  if (selectedModes.length === 0) throw new Error(usage);
  if (selectedModes.length > 1)
    throw new Error("Choose exactly one mode: --check, --update, or --srcinfo");

  const mode = selectedModes[0] as CliOptions["mode"];
  const channel = parseChannel(options.channel);
  const channelConfig = getChannelConfig(channel);
  const pkgbuildPath = options.pkgbuild ?? channelConfig.defaultPkgbuild;
  const srcinfoPath =
    options.srcinfoPath ?? `${dirname(pkgbuildPath)}/.SRCINFO`;
  const skipChecksum = options.skipChecksum ?? false;

  return {
    mode,
    channel,
    pkgbuildPath,
    srcinfoPath,
    skipChecksum,
  };
}
