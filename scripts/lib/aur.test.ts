import { describe, expect, test } from "bun:test";

import { getAurPackageFiles } from "./aur-manifest";
import {
  isAurPackageCurrent,
  type AurPackageReader,
  type RemoteAurFile,
} from "./aur";
import { getChannelTarget } from "./channels";

const target = getChannelTarget("nightly");

async function localAurFiles(): Promise<
  readonly RemoteAurFile[]
> {
  return (await getAurPackageFiles(target)).map(
    ({ filename, content, mode }) => ({
      filename,
      content,
      mode,
    }),
  );
}

describe("isAurPackageCurrent", () => {
  test("compares every published file", async () => {
    const files = await localAurFiles();
    const matchingReader: AurPackageReader = async () => files;
    expect(await isAurPackageCurrent(target, matchingReader)).toBe(true);

    const driftedReader: AurPackageReader = async () =>
      files.map((file) => ({
        ...file,
        content:
          file.filename === "cursor-launcher.sh"
            ? `${file.content}\nchanged\n`
            : file.content,
      }));
    expect(await isAurPackageCurrent(target, driftedReader)).toBe(false);
  });

  test("detects undeclared remote files", async () => {
    const files = await localAurFiles();
    expect(
      await isAurPackageCurrent(target, async () => [
        ...files,
        {
          filename: "obsolete.patch",
          content: "old",
          mode: "644",
        },
      ]),
    ).toBe(false);
  });

  test("detects remote mode drift", async () => {
    const files = await localAurFiles();
    expect(
      await isAurPackageCurrent(
        target,
        async () =>
          files.map((file) =>
            file.filename === "cursor-launcher.sh"
              ? { ...file, mode: "644" }
              : file,
          ),
      ),
    ).toBe(false);
  });

  test.each([
    ["CRLF", (content: string) => content.replace(/\n/g, "\r\n")],
    ["extra trailing newline", (content: string) => `${content}\n`],
  ])("detects %s content drift", async (_name, mutate) => {
    const files = await localAurFiles();
    expect(
      await isAurPackageCurrent(
        target,
        async () =>
          files.map((file) =>
            file.filename === "cursor-launcher.sh" &&
            file.content !== null
              ? { ...file, content: mutate(file.content) }
              : file,
          ),
      ),
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
