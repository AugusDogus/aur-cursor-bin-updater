import {
  latestVersionSchema,
  updateApiResponseSchema,
  type LatestVersion,
} from "../schemas";
import { Architecture } from "./architecture";
import type { ChannelConfig } from "./channels";
import {
  checkDebAvailability,
} from "./cursor-artifact";
import {
  defaultCursorFetch,
  requestCursor,
  type CursorFetch,
} from "./cursor-transport";
import { Release, type Release as ReleaseValue } from "./release";

function extractCommitFromDownloadUrl(downloadUrl: string) {
  const pathname = new URL(downloadUrl).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const productionIndex = segments.indexOf("production");
  if (productionIndex < 0) return "";
  return segments[productionIndex + 1] ?? "";
}

async function getLatestVersion(
  channel: ChannelConfig,
  architecture: (typeof Architecture.all)[number],
  fetcher: CursorFetch,
): Promise<LatestVersion | null> {
  const machineHashPlaceholder = "deadbeef";
  const probePkgver = "0.0.0";
  const updateUrl = `https://api2.cursor.sh/updates/api/update/${architecture.updatePlatform}/cursor/${probePkgver}/${machineHashPlaceholder}/${channel.releaseTrack}`;

  const response = await requestCursor(fetcher, updateUrl, {
    timeoutMs: 30_000,
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
  });
}

export async function getLatestRelease(
  channel: ChannelConfig,
  fetcher: CursorFetch = defaultCursorFetch,
): Promise<ReleaseValue> {
  const releases = await Architecture.mapValues(
    async (architecture) =>
      await getLatestVersion(channel, architecture, fetcher),
  );
  const alignment = Release.align(releases);
  if (alignment.status !== "aligned") return alignment;

  const artifactChecks = await Architecture.mapValues(
    async (architecture) =>
      await checkDebAvailability(alignment.latest, architecture, fetcher),
  );
  return Release.afterArtifactChecks(alignment, artifactChecks);
}
