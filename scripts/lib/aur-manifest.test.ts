import { describe, expect, test } from "bun:test";

import { getAurPackageFiles } from "./aur-manifest";
import { getChannelTarget } from "./channels";

describe("getAurPackageFiles", () => {
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
});
