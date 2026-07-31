import { file } from "bun";
import { describe, expect, test } from "bun:test";

import { isAurPackageCurrent, type AurFetch } from "./aur";
import { getChannelTarget } from "./channels";
import { generateSrcinfo } from "./pkgbuild";

const target = getChannelTarget("nightly");

async function localAurFiles() {
  return {
    PKGBUILD: await file(target.pkgbuild_path).text(),
    ".SRCINFO": await generateSrcinfo(target.pkgbuild_path),
    "cursor.desktop": await file("packaging/common/cursor.desktop").text(),
    "cursor-launcher.sh": await file(
      "packaging/common/cursor-launcher.sh",
    ).text(),
  };
}

function filenameFromRequest(input: string) {
  const segments = new URL(input).pathname.split("/");
  return decodeURIComponent(segments.at(-1) ?? "");
}

describe("isAurPackageCurrent", () => {
  test("compares every published file", async () => {
    const files: Readonly<Record<string, string>> = await localAurFiles();
    const matchingFetch: AurFetch = async (input) => {
      const content = files[filenameFromRequest(input)];
      return content === undefined
        ? new Response(null, { status: 404 })
        : new Response(content);
    };
    expect(await isAurPackageCurrent(target, matchingFetch)).toBe(true);

    const driftedFetch: AurFetch = async (input) => {
      const filename = filenameFromRequest(input);
      const content = files[filename];
      return new Response(
        filename === "cursor-launcher.sh" ? `${content}\nchanged\n` : content,
      );
    };
    expect(await isAurPackageCurrent(target, driftedFetch)).toBe(false);
  });

  test("fails closed when AUR cannot be compared", async () => {
    expect(
      isAurPackageCurrent(
        target,
        async () => new Response(null, { status: 503 }),
      ),
    ).rejects.toThrow("AUR comparison failed");
  });
});
