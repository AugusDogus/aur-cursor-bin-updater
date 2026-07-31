import { afterEach, describe, expect, test } from "bun:test";
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
  });
});
