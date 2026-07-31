import { afterEach, describe, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const helperPath = join(import.meta.dir, "aur-payload.sh");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "aur-payload-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runMaterialize(args: readonly string[]) {
  const process = Bun.spawn(
    [
      "bash",
      "-c",
      'source "$1"; shift; materialize_aur_payload "$@"',
      "bash",
      helperPath,
      ...args,
    ],
    { stderr: "pipe" },
  );
  return {
    exitCode: await process.exited,
    stderr: await new Response(process.stderr).text(),
  };
}

async function materialize(
  manifestPath: string,
  sourceDirectory: string,
  destinationDirectory: string,
) {
  return runMaterialize([
    manifestPath,
    sourceDirectory,
    destinationDirectory,
  ]);
}

const rejectionCases = [
  [
    "missing manifest",
    undefined,
    "Missing AUR publication manifest",
  ],
  ["empty manifest", "", "AUR publication manifest is empty"],
  ["invalid mode", "600\tPKGBUILD\n", "Invalid AUR file mode"],
  [
    "unsafe filename",
    "644\t../escaped\n",
    "Invalid AUR filename",
  ],
  [
    "reserved current-directory filename",
    "644\t.\n",
    "Reserved AUR filename",
  ],
  [
    "reserved parent-directory filename",
    "644\t..\n",
    "Reserved AUR filename",
  ],
  [
    "reserved manifest filename",
    "644\t.publish-manifest\n",
    "Reserved AUR filename",
  ],
  [
    "duplicate filename",
    "644\tPKGBUILD\n644\tPKGBUILD\n",
    "Duplicate AUR filename",
  ],
  [
    "missing PKGBUILD",
    "644\tcursor.desktop\n",
    "AUR publication manifest must contain exactly one PKGBUILD",
  ],
  [
    "missing staged file",
    "644\tPKGBUILD\n",
    "Missing staged AUR file",
  ],
] as const;

describe("materialize_aur_payload", () => {
  test("copies every validated manifest entry with its declared mode", async () => {
    const root = await temporaryDirectory();
    const sourceDirectory = join(root, "source");
    const destinationDirectory = join(root, "destination");
    const manifestPath = join(sourceDirectory, ".publish-manifest");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(destinationDirectory),
    ]);
    await Promise.all([
      writeFile(manifestPath, "644\tPKGBUILD\n755\tlauncher.sh\n"),
      writeFile(join(sourceDirectory, "PKGBUILD"), "pkgname=test\n"),
      writeFile(join(sourceDirectory, "launcher.sh"), "#!/bin/sh\n"),
    ]);
    await chmod(join(sourceDirectory, "launcher.sh"), 0o644);

    expect(
      await materialize(
        manifestPath,
        sourceDirectory,
        destinationDirectory,
      ),
    ).toEqual({ exitCode: 0, stderr: "" });
    expect(
      await Bun.file(join(destinationDirectory, "PKGBUILD")).text(),
    ).toBe("pkgname=test\n");
    expect(
      (await stat(join(destinationDirectory, "launcher.sh"))).mode &
        0o777,
    ).toBe(0o755);
  });

  test.each(rejectionCases)(
    "rejects %s",
    async (_name, manifest, expectedError) => {
      const root = await temporaryDirectory();
      const sourceDirectory = join(root, "source");
      const destinationDirectory = join(root, "destination");
      const manifestPath = join(sourceDirectory, ".publish-manifest");
      await Promise.all([
        mkdir(sourceDirectory),
        mkdir(destinationDirectory),
      ]);
      if (manifest !== undefined) {
        await writeFile(manifestPath, manifest);
      }

      const result = await materialize(
        manifestPath,
        sourceDirectory,
        destinationDirectory,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(expectedError);
    },
  );

  test("returns usage status for the wrong argument count", async () => {
    expect(await runMaterialize([])).toEqual({
      exitCode: 2,
      stderr: expect.stringContaining("Usage: materialize_aur_payload"),
    });
  });

  test("rejects a missing destination directory", async () => {
    const root = await temporaryDirectory();
    const sourceDirectory = join(root, "source");
    const destinationDirectory = join(root, "missing");
    const manifestPath = join(sourceDirectory, ".publish-manifest");
    await mkdir(sourceDirectory);
    await Promise.all([
      writeFile(manifestPath, "644\tPKGBUILD\n"),
      writeFile(join(sourceDirectory, "PKGBUILD"), "pkgname=test\n"),
    ]);

    const result = await materialize(
      manifestPath,
      sourceDirectory,
      destinationDirectory,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "AUR destination directory is missing or not writable",
    );
  });

  test("reports an install failure instead of partial success", async () => {
    const root = await temporaryDirectory();
    const sourceDirectory = join(root, "source");
    const destinationDirectory = join(root, "destination");
    const manifestPath = join(sourceDirectory, ".publish-manifest");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(destinationDirectory),
    ]);
    await Promise.all([
      writeFile(manifestPath, "644\tPKGBUILD\n"),
      writeFile(join(sourceDirectory, "PKGBUILD"), "pkgname=test\n"),
    ]);
    await chmod(join(sourceDirectory, "PKGBUILD"), 0o000);

    const result = await materialize(
      manifestPath,
      sourceDirectory,
      destinationDirectory,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Failed to install AUR file: PKGBUILD",
    );
  });
});
