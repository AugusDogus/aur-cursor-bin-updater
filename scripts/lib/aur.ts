import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { getAurPackageFiles } from "./aur-manifest";
import type { ChannelTarget } from "./channels";

export type RemoteAurFile = {
  filename: string;
  content: string | null;
};

export type AurPackageReader = (
  packageName: string,
) => Promise<readonly RemoteAurFile[]>;

const execFileAsync = promisify(execFile);

async function readAurPackageFromGit(packageName: string) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "aur-package-"),
  );
  const repositoryDirectory = join(
    temporaryDirectory,
    "repository",
  );
  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        `https://aur.archlinux.org/${encodeURIComponent(packageName)}.git`,
        repositoryDirectory,
      ],
      { timeout: 30_000 },
    );
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repositoryDirectory, "ls-files", "-z"],
      { timeout: 30_000 },
    );
    const filenames = stdout.split("\0").filter(Boolean);
    return await Promise.all(
      filenames.map(async (filename) => {
        const path = join(repositoryDirectory, filename);
        const metadata = await lstat(path);
        return {
          filename,
          content: metadata.isFile()
            ? await readFile(path, "utf8")
            : null,
        };
      }),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const defaultAurPackageReader: AurPackageReader =
  readAurPackageFromGit;

function normalize(content: string) {
  return `${content.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`;
}

export async function isAurPackageCurrent(
  target: ChannelTarget,
  readAurPackage: AurPackageReader = defaultAurPackageReader,
) {
  const localFiles = await getAurPackageFiles(target);
  let remoteFiles: readonly RemoteAurFile[];
  try {
    remoteFiles = await readAurPackage(target.aur_package);
  } catch (error: unknown) {
    throw new Error(
      `AUR comparison failed for ${target.aur_package}`,
      { cause: error },
    );
  }

  if (remoteFiles.length !== localFiles.length) return false;
  const remoteByFilename = new Map(
    remoteFiles.map((remoteFile) => [
      remoteFile.filename,
      remoteFile.content,
    ]),
  );
  if (remoteByFilename.size !== remoteFiles.length) return false;

  return localFiles.every(({ filename, content }) => {
    const remoteContent = remoteByFilename.get(filename);
    return (
      remoteContent !== undefined &&
      remoteContent !== null &&
      normalize(remoteContent) === normalize(content)
    );
  });
}
