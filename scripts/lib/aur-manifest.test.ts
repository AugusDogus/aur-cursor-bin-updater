import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { file, write } from "bun";

import {
  aurPublishManifestName,
  getAurPackageFiles,
  replaceStagingDirectory,
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

  test("ties pkgbuild validation to the PKGBUILD filename at typecheck time", () => {
    // @ts-expect-error The pkgbuild role requires the literal PKGBUILD filename.
    const invalidFile: AurPackageFile = {
      filename: "metadata",
      mode: "644",
      content: "invalid",
      validation: "pkgbuild",
    };

    expect(invalidFile.filename).toBe("metadata");
  });

  test("requires exactly one PKGBUILD", async () => {
    await expect(
      stageAurFiles([], await temporaryDirectory()),
    ).rejects.toThrow(
      "AUR manifest must declare exactly one PKGBUILD, found 0",
    );
  });

  test("rejects unsafe filenames before staging", async () => {
    const parentDirectory = await temporaryDirectory();
    const stagingDirectory = join(parentDirectory, ".aur");

    await expect(
      stageAurFiles(
        [
          {
            filename: "../escaped",
            mode: "644",
            content: "unsafe",
            validation: "none",
          },
          {
            filename: "PKGBUILD",
            mode: "644",
            content: "source=()\nsha512sums=()\n",
            validation: "pkgbuild",
          },
        ],
        stagingDirectory,
      ),
    ).rejects.toThrow("Invalid AUR filename: ../escaped");
    expect(await file(join(parentDirectory, "escaped")).exists()).toBe(
      false,
    );
    expect(await file(stagingDirectory).exists()).toBe(false);
  });

  test.each([".", "..", aurPublishManifestName])(
    "rejects reserved filename %s before staging",
    async (filename) => {
      const stagingDirectory = join(
        await temporaryDirectory(),
        ".aur",
      );

      await expect(
        stageAurFiles(
          [
            {
              filename,
              mode: "644",
              content: "reserved",
              validation: "none",
            },
            {
              filename: "PKGBUILD",
              mode: "644",
              content: "source=()\nsha512sums=()\n",
              validation: "pkgbuild",
            },
          ],
          stagingDirectory,
        ),
      ).rejects.toThrow(`Reserved AUR filename: ${filename}`);
      expect(await file(stagingDirectory).exists()).toBe(false);
    },
  );

  test("rejects duplicate filenames before staging", async () => {
    const stagingDirectory = join(
      await temporaryDirectory(),
      ".aur",
    );

    await expect(
      stageAurFiles(
        [
          {
            filename: "PKGBUILD",
            mode: "644",
            content: "source=()\nsha512sums=()\n",
            validation: "pkgbuild",
          },
          {
            filename: "PKGBUILD",
            mode: "644",
            content: "replacement",
            validation: "none",
          },
        ],
        stagingDirectory,
      ),
    ).rejects.toThrow(
      "AUR manifest contains duplicate filename: PKGBUILD",
    );
    expect(await file(stagingDirectory).exists()).toBe(false);
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

  test("preserves the previous payload when validation fails", async () => {
    const parentDirectory = await temporaryDirectory();
    const stagingDirectory = join(parentDirectory, ".aur");
    const markerPath = join(stagingDirectory, "previous-payload");
    await mkdir(stagingDirectory);
    await write(markerPath, "preserved");

    await expect(
      stageAurFiles(
        [
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
        ],
        stagingDirectory,
      ),
    ).rejects.toThrow("Staged AUR checksum validation failed");

    expect(await file(markerPath).text()).toBe("preserved");
    expect(
      await file(
        join(stagingDirectory, aurPublishManifestName),
      ).exists(),
    ).toBe(false);
  });

  test("replaces a validated payload without retaining stale files", async () => {
    const parentDirectory = await temporaryDirectory();
    const stagingDirectory = join(parentDirectory, ".aur");
    const stalePath = join(stagingDirectory, "stale-file");
    await mkdir(stagingDirectory);
    await write(stalePath, "stale");

    await stageAurFiles(
      [
        {
          filename: "PKGBUILD",
          mode: "644",
          content: "source=()\nsha512sums=()\n",
          validation: "pkgbuild",
        },
      ],
      stagingDirectory,
    );

    expect(await file(stalePath).exists()).toBe(false);
    expect(
      await file(
        join(stagingDirectory, aurPublishManifestName),
      ).text(),
    ).toBe("644\tPKGBUILD\n");
  });

  test("restores the previous payload when replacement fails", async () => {
    const parentDirectory = await temporaryDirectory();
    const sourceDirectory = join(parentDirectory, "next");
    const destinationDirectory = join(parentDirectory, ".aur");
    const markerPath = join(destinationDirectory, "previous-payload");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(destinationDirectory),
    ]);
    await write(markerPath, "preserved");
    const replacementError = new Error("replacement failed");
    let renameCount = 0;

    await expect(
      replaceStagingDirectory(
        sourceDirectory,
        destinationDirectory,
        async (sourcePath, destinationPath) => {
          renameCount += 1;
          if (renameCount === 2) throw replacementError;
          await rename(sourcePath, destinationPath);
        },
      ),
    ).rejects.toBe(replacementError);

    expect(renameCount).toBe(3);
    expect(await file(markerPath).text()).toBe("preserved");
  });

  test("preserves replacement and restore errors", async () => {
    const parentDirectory = await temporaryDirectory();
    const sourceDirectory = join(parentDirectory, "next");
    const destinationDirectory = join(parentDirectory, ".aur");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(destinationDirectory),
    ]);
    const replacementError = new Error("replacement failed");
    const restoreError = new Error("restore failed");
    let renameCount = 0;

    const error = await replaceStagingDirectory(
      sourceDirectory,
      destinationDirectory,
      async (sourcePath, destinationPath) => {
        renameCount += 1;
        if (renameCount === 2) throw replacementError;
        if (renameCount === 3) throw restoreError;
        await rename(sourcePath, destinationPath);
      },
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) return;
    expect(error.errors).toEqual([replacementError, restoreError]);
  });
});
