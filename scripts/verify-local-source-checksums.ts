import process from "node:process";
import { Command } from "commander";

import { getLocalSourceChecksumFailures } from "./lib/local-source-checksums";

const usage =
  "Usage: bun scripts/verify-local-source-checksums.ts --pkgbuild <path> --source <path> [--source <path> ...]";

class UsageError extends Error {}

interface CliOptions {
  pkgbuildPath: string;
  sourcePaths: string[];
}

function parseCliOptions(args: string[]): CliOptions {
  const program = new Command()
    .name("scripts/verify-local-source-checksums.ts")
    .exitOverride()
    .allowExcessArguments(false)
    .requiredOption("--pkgbuild <path>", "Path to PKGBUILD")
    .option(
      "--source <path>",
      "Path to a local source file to verify",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    );

  try {
    program.parse(args, { from: "user" });
  } catch {
    throw new UsageError(usage);
  }

  const options = program.opts<{
    pkgbuild: string;
    source: string[];
  }>();

  return !options.pkgbuild || options.source.length === 0
    ? (() => {
        throw new UsageError(usage);
      })()
    : {
        pkgbuildPath: options.pkgbuild,
        sourcePaths: options.source,
      };
}

const { pkgbuildPath, sourcePaths } = parseCliOptions(
  process.argv.slice(2),
);
const failureMessages = await getLocalSourceChecksumFailures(
  pkgbuildPath,
  sourcePaths,
);
if (failureMessages.length > 0) {
  console.error(failureMessages.join("\n"));
  process.exit(1);
}
