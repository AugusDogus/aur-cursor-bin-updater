import type { ChannelTarget } from "./channels";
import { getAurPackageFiles } from "./aur-manifest";

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
  const localFiles = await getAurPackageFiles(target);

  const comparisons = await Promise.all(
    localFiles.map(async ({ filename, content }) => {
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
      return normalize(await response.text()) === normalize(content);
    }),
  );
  return comparisons.every(Boolean);
}
