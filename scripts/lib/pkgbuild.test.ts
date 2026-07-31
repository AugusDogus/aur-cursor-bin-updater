import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LatestVersion } from "../schemas";
import type { ArchitectureValues } from "./architecture";
import { generateSrcinfo, updatePkgbuild } from "./pkgbuild";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function writeTemporaryPkgbuild(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), "pkgbuild-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "PKGBUILD");
  await writeFile(path, contents);
  return path;
}

const latest: LatestVersion = {
  pkgver: "2.0.0",
  upstreamPkgver: "2.0.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
};

const multiArchitecturePkgbuild = `pkgname=cursor-test-bin
pkgver=1.0.0
_upstream_pkgver=1.0.0
pkgrel=2
pkgdesc='Test package'
arch=('x86_64' 'aarch64')
url='https://example.com'
license=('custom')
source_x86_64=("cursor_\${_upstream_pkgver}_amd64.deb::https://example.com/\${_commit}/cursor_\${_upstream_pkgver}_amd64.deb")
source_aarch64=("cursor_\${_upstream_pkgver}_arm64.deb::https://example.com/\${_commit}/cursor_\${_upstream_pkgver}_arm64.deb")
source=('local-file')
sha512sums_x86_64=('SKIP')
sha512sums_aarch64=('SKIP')
sha512sums=('local-checksum')
sha512sums_x86_64[0]=old-amd64
sha512sums_aarch64[0]=old-arm64
_commit=old-commit
`;

describe("updatePkgbuild", () => {
  test("updates every supported architecture by PKGBUILD name", async () => {
    const path = await writeTemporaryPkgbuild(multiArchitecturePkgbuild);
    const checksums: ArchitectureValues<string> = {
      x86_64: "new-amd64",
      aarch64: "new-arm64",
    };

    await updatePkgbuild(path, latest, checksums);

    const updated = await readFile(path, "utf8");
    expect(updated).toContain("pkgver=2.0.0");
    expect(updated).toContain("_upstream_pkgver=2.0.0");
    expect(updated).toContain("pkgrel=1");
    expect(updated).toContain(`_commit=${latest.commit}`);
    expect(updated).toContain("sha512sums_x86_64[0]=new-amd64");
    expect(updated).toContain("sha512sums_aarch64[0]=new-arm64");
  });

  test("requires checksum data for every architecture at typecheck time", () => {
    // @ts-expect-error aarch64 cannot be omitted.
    const checksums: ArchitectureValues<string> = {
      x86_64: "new-amd64",
    };

    expect(checksums.x86_64).toBe("new-amd64");
  });

  test("is idempotent", async () => {
    const path = await writeTemporaryPkgbuild(multiArchitecturePkgbuild);
    const checksums: ArchitectureValues<string> = {
      x86_64: "new-amd64",
      aarch64: "new-arm64",
    };

    await updatePkgbuild(path, latest, checksums);
    const firstUpdate = await readFile(path, "utf8");
    await updatePkgbuild(path, latest, checksums);
    const secondUpdate = await readFile(path, "utf8");

    expect(secondUpdate).toBe(firstUpdate);
  });
});

describe("generateSrcinfo", () => {
  test("derives architecture-specific fields from the PKGBUILD arch array", async () => {
    const path = await writeTemporaryPkgbuild(`pkgname=future-test-bin
pkgver=1.0.0
pkgrel=1
pkgdesc='Future architecture'
arch=('riscv64')
url='https://example.com'
license=('custom')
source_riscv64=('future.deb::https://example.com/future.deb')
sha512sums_riscv64=('future-checksum')
`);

    const srcinfo = await generateSrcinfo(path);

    expect(srcinfo).toContain("\tarch = riscv64");
    expect(srcinfo).toContain(
      "\tsource_riscv64 = future.deb::https://example.com/future.deb",
    );
    expect(srcinfo).toContain("\tsha512sums_riscv64 = future-checksum");
    expect(srcinfo).not.toContain("source_x86_64");
    expect(srcinfo).not.toContain("source_aarch64");
  });
});
