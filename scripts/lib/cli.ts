import { dirname } from "node:path";
import { Command } from "commander";

import {
  channelKeySchema,
  getChannelConfig,
  getChannelTarget,
  type ChannelKey,
  type ChannelTarget,
} from "./channels";

const usage =
  "Usage: bun scripts/update.ts [--check|--update|--prepare] --channel <nightly|early-access> [--pkgbuild <path>] [--skip-checksum] [--force-publish], or bun scripts/update.ts --srcinfo --pkgbuild <path> [--srcinfo-path <path>]";

interface ChannelFileCommand {
  channel: ChannelKey;
  pkgbuildPath: string;
}

export type CliCommand =
  | (ChannelFileCommand & { mode: "check" })
  | (ChannelFileCommand & {
      mode: "update";
      skipChecksum: boolean;
    })
  | {
      mode: "prepare";
      target: ChannelTarget;
      skipChecksum: boolean;
      forcePublish: boolean;
    }
  | {
      mode: "srcinfo";
      pkgbuildPath: string;
      srcinfoPath: string;
    };

export function getUsageText() {
  return usage;
}

function parseChannel(rawChannel: string | undefined) {
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
}): CliCommand["mode"] {
  const selectedModes: CliCommand["mode"][] = [];
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

export function parseCliOptions(args: string[]): CliCommand {
  const program = new Command()
    .name("scripts/update.ts")
    .exitOverride()
    .allowExcessArguments(false)
    .option("--check", "Output update check JSON")
    .option("--update", "Update PKGBUILD in place")
    .option("--prepare", "Prepare a PKGBUILD and output its publication plan")
    .option("--srcinfo", "Generate .SRCINFO from PKGBUILD")
    .option("--channel <channel>", "nightly or early-access")
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
    channel?: string;
    pkgbuild?: string;
    srcinfoPath?: string;
    skipChecksum?: boolean;
    forcePublish?: boolean;
  }>();
  const mode = parseMode(options);

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
  if (options.forcePublish && mode !== "prepare") {
    throw new Error("--force-publish requires --prepare");
  }

  if (mode === "srcinfo") {
    if (options.channel !== undefined) {
      throw new Error("--channel is not used with --srcinfo");
    }
    if (options.pkgbuild === undefined) {
      throw new Error("--srcinfo requires --pkgbuild");
    }
    return {
      mode,
      pkgbuildPath: options.pkgbuild,
      srcinfoPath:
        options.srcinfoPath ?? `${dirname(options.pkgbuild)}/.SRCINFO`,
    };
  }

  const channel = parseChannel(options.channel);
  if (mode === "prepare") {
    if (options.pkgbuild !== undefined) {
      throw new Error(
        "--prepare uses the selected channel's canonical PKGBUILD",
      );
    }
    return {
      mode,
      target: getChannelTarget(channel),
      skipChecksum: options.skipChecksum ?? false,
      forcePublish: options.forcePublish ?? false,
    };
  }

  const pkgbuildPath =
    options.pkgbuild ?? getChannelConfig(channel).defaultPkgbuild;
  if (mode === "check") return { mode, channel, pkgbuildPath };
  return {
    mode,
    channel,
    pkgbuildPath,
    skipChecksum: options.skipChecksum ?? false,
  };
}
