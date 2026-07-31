import {
  chmod,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { file, write } from "bun";

import type { ChannelTarget } from "./channels";
import { getLocalSourceChecksumFailures } from "./local-source-checksums";
import { generateSrcinfo } from "./pkgbuild";

export const aurStagingDirectory = ".aur";
export const aurPublishManifestName = ".publish-manifest";
const aurFilenamePattern = /^[A-Za-z0-9._-]+$/;

type AurPackageFileContents = {
  mode: "644" | "755";
  content: string;
};

export type AurPackageFile = AurPackageFileContents &
  (
    | {
        filename: "PKGBUILD";
        validation: "pkgbuild";
      }
    | {
        filename: string;
        validation: "local-source" | "none";
      }
  );

export async function getAurPackageFiles(
  target: ChannelTarget,
): Promise<readonly AurPackageFile[]> {
  return [
    {
      filename: "PKGBUILD",
      mode: "644",
      content: await file(target.pkgbuild_path).text(),
      validation: "pkgbuild",
    },
    {
      filename: ".SRCINFO",
      mode: "644",
      content: await generateSrcinfo(target.pkgbuild_path),
      validation: "none",
    },
    {
      filename: "cursor.desktop",
      mode: "644",
      content: await file("packaging/common/cursor.desktop").text(),
      validation: "local-source",
    },
    {
      filename: "cursor-launcher.sh",
      mode: "755",
      content: await file(
        "packaging/common/cursor-launcher.sh",
      ).text(),
      validation: "local-source",
    },
  ];
}

export function serializeAurPublishManifest(
  files: readonly AurPackageFile[],
) {
  return `${files
    .map(({ filename, mode }) => `${mode}\t${filename}`)
    .join("\n")}\n`;
}

function validateAurPackageFiles(
  files: readonly AurPackageFile[],
) {
  const filenames = new Set<string>();
  for (const { filename } of files) {
    if (!aurFilenamePattern.test(filename)) {
      throw new Error(`Invalid AUR filename: ${filename}`);
    }
    if (filenames.has(filename)) {
      throw new Error(`AUR manifest contains duplicate filename: ${filename}`);
    }
    filenames.add(filename);
  }

  const pkgbuildFiles = files.filter(
    ({ validation }) => validation === "pkgbuild",
  );
  if (pkgbuildFiles.length !== 1) {
    throw new Error(
      `AUR manifest must declare exactly one PKGBUILD, found ${pkgbuildFiles.length}`,
    );
  }
  const pkgbuildFile = pkgbuildFiles[0];
  if (pkgbuildFile === undefined) {
    throw new Error("AUR manifest does not declare a PKGBUILD");
  }
  return pkgbuildFile;
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

async function replaceStagingDirectory(
  sourceDirectory: string,
  destinationDirectory: string,
) {
  const parentDirectory = dirname(destinationDirectory);
  const destinationName = basename(destinationDirectory);
  const backupDirectory = await mkdtemp(
    join(parentDirectory, `.${destinationName}-backup-`),
  );
  await rm(backupDirectory, { recursive: true, force: true });

  let hasBackup = false;
  try {
    await rename(destinationDirectory, backupDirectory);
    hasBackup = true;
  } catch (error: unknown) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(sourceDirectory, destinationDirectory);
  } catch (error: unknown) {
    if (hasBackup) {
      await rename(backupDirectory, destinationDirectory);
    }
    throw error;
  }

  if (hasBackup) {
    await rm(backupDirectory, { recursive: true, force: true });
  }
}

export async function stageAurFiles(
  files: readonly AurPackageFile[],
  stagingDirectory = aurStagingDirectory,
) {
  const pkgbuildFile = validateAurPackageFiles(files);
  const destinationDirectory = resolve(stagingDirectory);
  const parentDirectory = dirname(destinationDirectory);
  const destinationName = basename(destinationDirectory);
  await mkdir(parentDirectory, { recursive: true });
  const temporaryDirectory = await mkdtemp(
    join(parentDirectory, `.${destinationName}-staging-`),
  );

  try {
    await Promise.all(
      files.map(async ({ filename, mode, content }) => {
        const stagedPath = join(temporaryDirectory, filename);
        await write(stagedPath, content);
        await chmod(stagedPath, mode === "755" ? 0o755 : 0o644);
      }),
    );

    const checksumFailures = await getLocalSourceChecksumFailures(
      join(temporaryDirectory, pkgbuildFile.filename),
      files
        .filter(({ validation }) => validation === "local-source")
        .map(({ filename }) => join(temporaryDirectory, filename)),
    );
    if (checksumFailures.length > 0) {
      throw new Error(
        `Staged AUR checksum validation failed:\n${checksumFailures.join("\n")}`,
      );
    }

    await write(
      join(temporaryDirectory, aurPublishManifestName),
      serializeAurPublishManifest(files),
    );
    await replaceStagingDirectory(
      temporaryDirectory,
      destinationDirectory,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function stageAurPackage(target: ChannelTarget) {
  await stageAurFiles(await getAurPackageFiles(target));
}
