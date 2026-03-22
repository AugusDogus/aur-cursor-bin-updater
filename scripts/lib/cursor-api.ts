import { CryptoHasher } from "bun";

import { latestVersionSchema, updateApiResponseSchema, type LatestVersion } from "../schemas";
import type { ChannelConfig } from "./channels";

const USER_AGENT = "aur-cursor-bin-updater/1.0";

function extractCommitFromDownloadUrl(downloadUrl: string) {
  const pathname = new URL(downloadUrl).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const productionIndex = segments.indexOf("production");
  if (productionIndex < 0) return "";
  return segments[productionIndex + 1] ?? "";
}

function createDebUrl(latest: LatestVersion) {
  return `https://downloads.cursor.com/production/${latest.commit}/linux/x64/deb/amd64/deb/cursor_${latest.upstreamPkgver}_amd64.deb`;
}

async function digestStream(reader: any, hash: CryptoHasher): Promise<string> {
  const { done, value } = await reader.read();
  if (done) return hash.digest("hex");
  hash.update(value);
  return digestStream(reader, hash);
}

export async function getLatestVersion(channel: ChannelConfig) {
  const machineHashPlaceholder = "deadbeef";
  const probePkgver = "0.0.0";
  const updateUrl = `https://api2.cursor.sh/updates/api/update/linux-x64/cursor/${probePkgver}/${machineHashPlaceholder}/${channel.releaseTrack}`;

  const response = await fetch(updateUrl, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 204) return null;
  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`Unexpected API status ${response.status}: ${text}`);
  }

  const payload = updateApiResponseSchema.parse(await response.json());
  const commit = extractCommitFromDownloadUrl(payload.url);
  if (!commit) throw new Error("Could not parse commit from update API URL");

  return latestVersionSchema.parse({
    upstreamPkgver: payload.version,
    pkgver: payload.version.split("-").join("_"),
    commit,
    downloadUrl: payload.url,
  });
}

export async function computeDebSha512(latest: LatestVersion) {
  const response = await fetch(createDebUrl(latest), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);

  const hash = new CryptoHasher("sha512");
  return digestStream(response.body.getReader(), hash);
}
