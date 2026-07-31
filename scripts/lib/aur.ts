import { file } from "bun";

import type { ChannelTarget } from "./channels";
import { generateSrcinfo } from "./pkgbuild";

export type AurFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const defaultFetch: AurFetch = (input, init) => fetch(input, init);

function normalize(content: string) {
  return `${content.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`;
}

function getAurFileUrl(packageName: string, filename: string) {
  const url = new URL(
    `https://aur.archlinux.org/cgit/aur.git/plain/${encodeURIComponent(filename)}`,
  );
  url.searchParams.set("h", packageName);
  return url.toString();
}

export async function isAurPackageCurrent(
  target: ChannelTarget,
  fetcher: AurFetch = defaultFetch,
) {
  const localFiles = {
    PKGBUILD: await file(target.pkgbuild_path).text(),
    ".SRCINFO": await generateSrcinfo(target.pkgbuild_path),
    "cursor.desktop": await file("packaging/common/cursor.desktop").text(),
    "cursor-launcher.sh": await file(
      "packaging/common/cursor-launcher.sh",
    ).text(),
  };

  const comparisons = await Promise.all(
    Object.entries(localFiles).map(async ([filename, localContent]) => {
      const response = await fetcher(
        getAurFileUrl(target.aur_package, filename),
        { signal: AbortSignal.timeout(30_000) },
      );
      if (response.status === 404) return false;
      if (!response.ok) {
        throw new Error(
          `AUR comparison failed for ${target.aur_package}/${filename}: HTTP ${response.status}`,
        );
      }
      return normalize(await response.text()) === normalize(localContent);
    }),
  );
  return comparisons.every(Boolean);
}
