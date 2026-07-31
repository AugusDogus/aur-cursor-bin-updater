import { describe, expect, test } from "bun:test";

import { getAurPackageFiles } from "./aur-manifest";
import { isAurPackageCurrent, type AurFetch } from "./aur";
import { getChannelTarget } from "./channels";

const target = getChannelTarget("nightly");

async function localAurFiles() {
  return Object.fromEntries(
    (await getAurPackageFiles(target)).map(({ filename, content }) => [
      filename,
      content,
    ]),
  );
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
