import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

async function materialize(
  manifestPath: string,
  sourceDirectory: string,
  destinationDirectory: string,
) {
  const process = Bun.spawn(
    [
      "bash",
      "-c",
      'source "$1"; materialize_aur_payload "$2" "$3" "$4"',
      "bash",
      helperPath,
      manifestPath,
      sourceDirectory,
      destinationDirectory,
    ],
    { stderr: "pipe" },
  );
  return {
    exitCode: await process.exited,
    stderr: await new Response(process.stderr).text(),
  };
}

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

  test("rejects an empty manifest", async () => {
    const root = await temporaryDirectory();
    const sourceDirectory = join(root, "source");
    const destinationDirectory = join(root, "destination");
    const manifestPath = join(sourceDirectory, ".publish-manifest");
    await Promise.all([
      mkdir(sourceDirectory),
      mkdir(destinationDirectory),
    ]);
    await writeFile(manifestPath, "");

    const result = await materialize(
      manifestPath,
      sourceDirectory,
      destinationDirectory,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AUR publication manifest is empty");
  });
});
