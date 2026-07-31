import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getAurPackageFiles,
  serializeAurPublishManifest,
  stageAurFiles,
  type AurPackageFile,
} from "./aur-manifest";
import { getChannelTarget } from "./channels";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "aur-manifest-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("AUR manifest", () => {
  test("owns publication modes and checksum validation roles", async () => {
    const files = await getAurPackageFiles(
      getChannelTarget("nightly"),
    );

    expect(
      files.map(({ filename, mode, validation }) => ({
        filename,
        mode,
        validation,
      })),
    ).toEqual([
      {
        filename: "PKGBUILD",
        mode: "644",
        validation: "pkgbuild",
      },
      {
        filename: ".SRCINFO",
        mode: "644",
        validation: "none",
      },
      {
        filename: "cursor.desktop",
        mode: "644",
        validation: "local-source",
      },
      {
        filename: "cursor-launcher.sh",
        mode: "755",
        validation: "local-source",
      },
    ]);
  });

  test("serializes modes and filenames for the publisher", () => {
    const files: readonly AurPackageFile[] = [
      {
        filename: "PKGBUILD",
        mode: "644",
        content: "pkgname=test",
        validation: "pkgbuild",
      },
      {
        filename: "launcher.sh",
        mode: "755",
        content: "#!/bin/sh",
        validation: "local-source",
      },
    ];

    expect(serializeAurPublishManifest(files)).toBe(
      "644\tPKGBUILD\n755\tlauncher.sh\n",
    );
  });

  test("requires exactly one PKGBUILD", async () => {
    await expect(
      stageAurFiles([], await temporaryDirectory()),
    ).rejects.toThrow(
      "AUR manifest must declare exactly one PKGBUILD, found 0",
    );
  });

  test("rejects staged local-source checksum mismatches", async () => {
    const files: readonly AurPackageFile[] = [
      {
        filename: "PKGBUILD",
        mode: "644",
        content:
          "source=('source.txt')\nsha512sums=('invalid-checksum')\n",
        validation: "pkgbuild",
      },
      {
        filename: "source.txt",
        mode: "644",
        content: "actual content",
        validation: "local-source",
      },
    ];

    await expect(
      stageAurFiles(files, await temporaryDirectory()),
    ).rejects.toThrow("Staged AUR checksum validation failed");
  });
});
