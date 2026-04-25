import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import process from "node:process";
import { Command } from "commander";

import { parseSha512Sums, parseSourceEntries } from "./lib/pkgbuild";

const usage =
  "Usage: bun scripts/verify-local-source-checksums.ts --pkgbuild <path> --source <path> [--source <path> ...]";

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
    throw new Error(usage);
  }

  const options = program.opts<{
    pkgbuild: string;
    source: string[];
  }>();

  if (!options.pkgbuild || options.source.length === 0) {
    throw new Error(usage);
  }

  return {
    pkgbuildPath: options.pkgbuild,
    sourcePaths: options.source,
  };
}

function isRemoteSource(sourceEntry: string) {
  return (
    sourceEntry.startsWith("http://") ||
    sourceEntry.startsWith("https://") ||
    sourceEntry.includes("::")
  );
}

function getSourceFilename(sourceEntry: string) {
  return basename(sourceEntry.includes("::") ? sourceEntry.split("::")[0] ?? sourceEntry : sourceEntry);
}

function buildLocalSourceIndex(sources: string[]) {
  return sources.reduce((indexByFilename, sourceEntry, index) => {
    if (isRemoteSource(sourceEntry)) return indexByFilename;

    const filename = getSourceFilename(sourceEntry);
    const existingIndex = indexByFilename.get(filename);
    if (existingIndex !== undefined) {
      throw new Error(
        `Duplicate local source filename "${filename}" at indexes ${existingIndex} and ${index}`,
      );
    }

    return indexByFilename.set(filename, index);
  }, new Map<string, number>());
}

async function computeSha512(path: string) {
  const content = await readFile(path);
  return createHash("sha512").update(content).digest("hex");
}

async function main() {
  const { pkgbuildPath, sourcePaths } = parseCliOptions(process.argv.slice(2));

  try {
    await access(pkgbuildPath);
  } catch {
    throw new Error(`Missing PKGBUILD: ${pkgbuildPath}`);
  }

  const [sources, expectedSums] = await Promise.all([
    parseSourceEntries(pkgbuildPath),
    parseSha512Sums(pkgbuildPath),
  ]);
  const localSourceIndex = buildLocalSourceIndex(sources);

  let hasMismatch = false;

  for (const sourcePath of sourcePaths) {
    try {
      await access(sourcePath);
    } catch {
      console.error(`Missing source file: ${sourcePath}`);
      hasMismatch = true;
      continue;
    }

    const filename = basename(sourcePath);
    const sourceIndex = localSourceIndex.get(filename);
    if (sourceIndex === undefined) {
      console.error(`No local source entry found for ${sourcePath}`);
      hasMismatch = true;
      continue;
    }

    const expected = expectedSums[sourceIndex];
    if (!expected) {
      console.error(`Missing sha512sums entry ${sourceIndex} for ${sourcePath}`);
      hasMismatch = true;
      continue;
    }

    const actual = await computeSha512(sourcePath);
    if (expected === actual) continue;

    console.error(`Checksum mismatch for ${sourcePath}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    hasMismatch = true;
  }

  if (hasMismatch) {
    process.exit(1);
  }
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === usage) console.error(usage);
  else console.error(message);
  process.exit(1);
}
