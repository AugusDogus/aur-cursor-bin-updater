import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { basename } from "node:path";
import process from "node:process";
import { Command } from "commander";

import { parseSha512Sums, parseSourceEntries } from "./lib/pkgbuild";

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

function getSourceParts(sourceEntry: string) {
  const parts = sourceEntry.split("::");
  return {
    filename: parts[0] ?? "",
    location: parts.length > 1 ? parts.slice(1).join("::") : null,
  };
}

function isRemoteSource(sourceEntry: string) {
  const { location } = getSourceParts(sourceEntry);
  const candidate = location ?? sourceEntry;

  return ["http://", "https://", "ftp://", "git+"].some((prefix) =>
    candidate.startsWith(prefix),
  );
}

function getSourceFilename(sourceEntry: string) {
  return basename(getSourceParts(sourceEntry).filename);
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
  return createHash("sha512").update(await readFile(path)).digest("hex");
}

async function readSourceResult(sourcePath: string) {
  try {
    await access(sourcePath);
    return { sourcePath, exists: true as const };
  } catch {
    return { sourcePath, exists: false as const };
  }
}

const { pkgbuildPath, sourcePaths } = parseCliOptions(process.argv.slice(2));

try {
  await access(pkgbuildPath);
} catch {
  throw new Error(`Missing PKGBUILD: ${pkgbuildPath}`);
}

const [sources, expectedSums, sourceResults] = await Promise.all([
  parseSourceEntries(pkgbuildPath),
  parseSha512Sums(pkgbuildPath),
  Promise.all(sourcePaths.map(readSourceResult)),
]);
const localSourceIndex = buildLocalSourceIndex(sources);

const failureMessages = (
  await Promise.all(
    sourceResults.map(async (sourceResult) => {
      if (!sourceResult.exists) {
        return [`Missing source file: ${sourceResult.sourcePath}`];
      }

      const sourceIndex = localSourceIndex.get(basename(sourceResult.sourcePath));
      if (sourceIndex === undefined) {
        return [`No local source entry found for ${sourceResult.sourcePath}`];
      }

      const expected = expectedSums[sourceIndex];
      if (!expected) {
        return [
          `Missing sha512sums entry ${sourceIndex} for ${sourceResult.sourcePath}`,
        ];
      }

      const actual = await computeSha512(sourceResult.sourcePath);
      return expected === actual
        ? []
        : [
            `Checksum mismatch for ${sourceResult.sourcePath}`,
            `  expected: ${expected}`,
            `  actual:   ${actual}`,
          ];
    }),
  )
).flat();

if (failureMessages.length > 0) {
  console.error(failureMessages.join("\n"));
  process.exit(1);
}

process.exit(0);
