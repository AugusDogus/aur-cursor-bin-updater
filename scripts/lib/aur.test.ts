import { describe, expect, test } from "bun:test";

import { getAurPackageFiles } from "./aur-manifest";
import {
  isAurPackageCurrent,
  type AurPackageReader,
} from "./aur";
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

describe("isAurPackageCurrent", () => {
  test("compares every published file", async () => {
    const files: Readonly<Record<string, string>> = await localAurFiles();
    const matchingReader: AurPackageReader = async () =>
      Object.entries(files).map(([filename, content]) => ({
        filename,
        content,
      }));
    expect(await isAurPackageCurrent(target, matchingReader)).toBe(true);

    const driftedReader: AurPackageReader = async () =>
      Object.entries(files).map(([filename, content]) => ({
        filename,
        content:
          filename === "cursor-launcher.sh"
            ? `${content}\nchanged\n`
            : content,
      }));
    expect(await isAurPackageCurrent(target, driftedReader)).toBe(false);
  });

  test("detects undeclared remote files", async () => {
    const files = await localAurFiles();
    expect(
      await isAurPackageCurrent(target, async () => [
        ...Object.entries(files).map(([filename, content]) => ({
          filename,
          content,
        })),
        { filename: "obsolete.patch", content: "old" },
      ]),
    ).toBe(false);
  });

  test("fails closed when AUR cannot be compared", async () => {
    expect(
      isAurPackageCurrent(target, async () => {
        throw new Error("git clone failed");
      }),
    ).rejects.toThrow("AUR comparison failed");
  });
});
