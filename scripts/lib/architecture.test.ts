import { describe, expect, test } from "bun:test";

import {
  Architecture,
  type Architecture as ArchitectureDescriptor,
} from "./architecture";

describe("Architecture", () => {
  test("keeps Arch, Debian, Cursor, and update API names together", () => {
    expect(Architecture.all).toEqual([
      {
        pkgbuild: "x86_64",
        deb: "amd64",
        cursorPlatform: "x64",
        updatePlatform: "linux-x64",
      },
      {
        pkgbuild: "aarch64",
        deb: "arm64",
        cursorPlatform: "arm64",
        updatePlatform: "linux-arm64",
      },
    ]);
  });

  test("rejects mixed architecture mappings at typecheck time", () => {
    // @ts-expect-error Debian and update-platform values must belong to one row.
    const invalidArchitecture: ArchitectureDescriptor = {
      pkgbuild: "x86_64",
      deb: "arm64",
      cursorPlatform: "x64",
      updatePlatform: "linux-arm64",
    };

    expect(invalidArchitecture.pkgbuild).toBe("x86_64");
  });

  test("maps values by architecture key", async () => {
    expect(
      await Architecture.mapValues(async (architecture) => architecture.deb),
    ).toEqual({
      x86_64: "amd64",
      aarch64: "arm64",
    });
  });
});
