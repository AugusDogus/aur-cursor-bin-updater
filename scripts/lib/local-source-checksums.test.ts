import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getLocalSourceChecksumFailures } from "./local-source-checksums";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("getLocalSourceChecksumFailures", () => {
  test("requires every PKGBUILD local source in the manifest", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "local-source-checksums-"),
    );
    temporaryDirectories.push(directory);
    const pkgbuildPath = join(directory, "PKGBUILD");
    const declaredSourcePath = join(directory, "declared.txt");
    await Promise.all([
      writeFile(
        pkgbuildPath,
        `source=('declared.txt' 'missing.patch')
sha512sums=('SKIP' 'SKIP')
`,
      ),
      writeFile(declaredSourcePath, "declared"),
    ]);

    const failures = await getLocalSourceChecksumFailures(
      pkgbuildPath,
      [declaredSourcePath],
    );

    expect(failures).toContain(
      "PKGBUILD local source is missing from the manifest: missing.patch",
    );
    expect(failures).toContain(
      `Local source checksum cannot be SKIP: ${declaredSourcePath}`,
    );
  });

  test("reports a checksum mismatch", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "local-source-checksums-"),
    );
    temporaryDirectories.push(directory);
    const pkgbuildPath = join(directory, "PKGBUILD");
    const sourcePath = join(directory, "source.txt");
    const originalContent = "original";
    const expected = createHash("sha512")
      .update(originalContent)
      .digest("hex");
    await Promise.all([
      writeFile(
        pkgbuildPath,
        `source=('source.txt')
sha512sums=('${expected}')
`,
      ),
      writeFile(sourcePath, "modified"),
    ]);

    const failures = await getLocalSourceChecksumFailures(
      pkgbuildPath,
      [sourcePath],
    );

    expect(failures).toContain(`Checksum mismatch for ${sourcePath}`);
  });

  test("recognizes supported remote source forms", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "local-source-checksums-"),
    );
    temporaryDirectories.push(directory);
    const pkgbuildPath = join(directory, "PKGBUILD");
    await writeFile(
      pkgbuildPath,
      `source=(
  'https://example.com/one'
  'git://example.com/two'
  'three::ftps://example.com/three'
  'rsync://example.com/four'
  'svn+https://example.com/five'
  'hg+https://example.com/six'
  'bzr+https://example.com/seven'
  'fossil+https://example.com/eight'
)
sha512sums=('SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP' 'SKIP')
`,
    );

    expect(
      await getLocalSourceChecksumFailures(pkgbuildPath, []),
    ).toEqual([]);
  });
});
