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
  content: Uint8Array | null;
  mode: "644" | "755" | null;
};

export type AurPackageReader = (
  packageName: string,
) => Promise<readonly RemoteAurFile[]>;

const execFileAsync = promisify(execFile);

function normalizeGitMode(
  gitMode: string | undefined,
): RemoteAurFile["mode"] {
  if (gitMode === "100644") return "644";
  if (gitMode === "100755") return "755";
  return null;
}

function parseGitIndexEntry(entry: string) {
  const separatorIndex = entry.indexOf("\t");
  const metadata =
    separatorIndex < 0 ? "" : entry.slice(0, separatorIndex);
  const filename =
    separatorIndex < 0 ? "" : entry.slice(separatorIndex + 1);
  const [gitMode] = metadata.split(" ");
  return {
    filename,
    mode: normalizeGitMode(gitMode),
  };
}

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
      ["-C", repositoryDirectory, "ls-files", "--stage", "-z"],
      { timeout: 30_000 },
    );
    const indexEntries = stdout
      .split("\0")
      .filter(Boolean)
      .map(parseGitIndexEntry);
    return await Promise.all(
      indexEntries.map(async ({ filename, mode }) => {
        const path = join(repositoryDirectory, filename);
        const metadata = await lstat(path);
        return {
          filename,
          mode,
          content: metadata.isFile() ? await readFile(path) : null,
        };
      }),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const defaultAurPackageReader: AurPackageReader =
  readAurPackageFromGit;
const utf8Encoder = new TextEncoder();

export function hasEqualBytes(
  localContent: string,
  remoteContent: Uint8Array,
) {
  const localBytes = utf8Encoder.encode(localContent);
  return (
    localBytes.length === remoteContent.length &&
    localBytes.every((byte, index) => remoteContent[index] === byte)
  );
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
      `Remote AUR package ${target.aur_package} is unavailable or could not be read`,
      { cause: error },
    );
  }

  if (remoteFiles.length !== localFiles.length) return false;
  const remoteByFilename = new Map(
    remoteFiles.map((remoteFile) => [
      remoteFile.filename,
      remoteFile,
    ]),
  );
  if (remoteByFilename.size !== remoteFiles.length) return false;

  return localFiles.every(({ filename, mode, content }) => {
    const remoteFile = remoteByFilename.get(filename);
    return (
      remoteFile !== undefined &&
      remoteFile.mode === mode &&
      remoteFile.content !== null &&
      hasEqualBytes(content, remoteFile.content)
    );
  });
}
