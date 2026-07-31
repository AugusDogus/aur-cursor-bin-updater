import process from "node:process";
import { Command } from "commander";

import { stageAurPackage } from "./lib/aur-manifest";
import { channelKeySchema, getChannelTarget } from "./lib/channels";

const program = new Command()
  .name("scripts/stage-aur.ts")
  .exitOverride()
  .allowExcessArguments(false)
  .requiredOption("--channel <channel>", "nightly or early-access");

try {
  program.parse(process.argv.slice(2), { from: "user" });
  const { channel } = program.opts<{ channel: string }>();
  const parsedChannel = channelKeySchema.parse(channel);
  await stageAurPackage(getChannelTarget(parsedChannel));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
