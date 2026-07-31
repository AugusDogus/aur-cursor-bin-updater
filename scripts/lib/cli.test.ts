import { describe, expect, test } from "bun:test";

import { parseCliOptions } from "./cli";

describe("parseCliOptions", () => {
  test("selects exactly one mode", () => {
    expect(() =>
      parseCliOptions([
        "--check",
        "--update",
        "--channel",
        "nightly",
      ]),
    ).toThrow(
      "Choose exactly one mode: --check, --update, --prepare, or --srcinfo",
    );
  });

  test("prepares only the canonical channel PKGBUILD", () => {
    expect(
      parseCliOptions([
        "--prepare",
        "--force-publish",
        "--channel",
        "nightly",
      ]),
    ).toEqual({
      mode: "prepare",
      channel: "nightly",
      pkgbuildPath: "packaging/nightly/PKGBUILD",
      srcinfoPath: "packaging/nightly/.SRCINFO",
      skipChecksum: false,
      forcePublish: true,
    });
    expect(() =>
      parseCliOptions([
        "--prepare",
        "--channel",
        "nightly",
        "--pkgbuild",
        "other/PKGBUILD",
      ]),
    ).toThrow("--prepare uses the selected channel's canonical PKGBUILD");
  });

  test("rejects flags used outside their mode", () => {
    expect(() =>
      parseCliOptions([
        "--check",
        "--force-publish",
        "--channel",
        "nightly",
      ]),
    ).toThrow("--force-publish requires --prepare");
    expect(() =>
      parseCliOptions([
        "--check",
        "--skip-checksum",
        "--channel",
        "nightly",
      ]),
    ).toThrow("--skip-checksum requires --update or --prepare");
    expect(() =>
      parseCliOptions([
        "--update",
        "--srcinfo-path",
        "other/.SRCINFO",
        "--channel",
        "nightly",
      ]),
    ).toThrow("--srcinfo-path requires --srcinfo");
  });
});
