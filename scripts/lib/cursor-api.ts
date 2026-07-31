import { CryptoHasher } from "bun";

import { latestVersionSchema, updateApiResponseSchema, type LatestVersion } from "../schemas";
import {
  Architecture,
  type Architecture as ArchitectureDescriptor,
} from "./architecture";
import type { ChannelConfig } from "./channels";

const USER_AGENT = "aur-cursor-bin-updater/1.0";

export type CursorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type ArchitectureRelease = {
  architecture: ArchitectureDescriptor;
  latest: LatestVersion | null;
};

type UnavailableArtifact = {
  architecture: ArchitectureDescriptor;
  url: string;
  reason: string;
};

export type LatestRelease =
  | {
      status: "available";
      latest: LatestVersion;
    }
  | {
      status: "unavailable";
      releases: ArchitectureRelease[];
    }
  | {
      status: "architecture-mismatch";
      releases: ArchitectureRelease[];
    }
  | {
      status: "artifact-unavailable";
      latest: LatestVersion;
      artifacts: UnavailableArtifact[];
    };

export const LatestRelease = {
  message(release: LatestRelease) {
    switch (release.status) {
      case "available":
        return `Release ${release.latest.upstreamPkgver} is available for every supported architecture.`;
      case "unavailable":
        return "No update payload is available for any supported architecture.";
      case "architecture-mismatch":
        return `Architecture releases are not aligned: ${release.releases
          .map(({ architecture, latest }) =>
            latest
              ? `${architecture.pkgbuild}=${latest.upstreamPkgver} (${latest.commit})`
              : `${architecture.pkgbuild}=unavailable`,
          )
          .join(", ")}. The current package remains unchanged.`;
      case "artifact-unavailable":
        return `Release ${release.latest.upstreamPkgver} is not ready for every architecture: ${release.artifacts
          .map(
            ({ architecture, reason }) =>
              `${architecture.pkgbuild} artifact failed availability check (${reason})`,
          )
          .join(", ")}. The current package remains unchanged.`;
    }
  },
} as const;

const defaultFetch: CursorFetch = (input, init) => fetch(input, init);

function extractCommitFromDownloadUrl(downloadUrl: string) {
  const pathname = new URL(downloadUrl).pathname;
  const segments = pathname.split("/").filter(Boolean);
  const productionIndex = segments.indexOf("production");
  if (productionIndex < 0) return "";
  return segments[productionIndex + 1] ?? "";
}

export function createDebUrl(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
) {
  return `https://downloads.cursor.com/production/${latest.commit}/linux/${architecture.cursorPlatform}/deb/${architecture.deb}/deb/cursor_${latest.upstreamPkgver}_${architecture.deb}.deb`;
}

async function digestStream(
  stream: ReadableStream<Uint8Array>,
  hash: CryptoHasher,
): Promise<string> {
  for await (const value of stream) {
    hash.update(value);
  }
  return hash.digest("hex");
}

async function getLatestVersion(
  channel: ChannelConfig,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch,
) {
  const machineHashPlaceholder = "deadbeef";
  const probePkgver = "0.0.0";
  const updateUrl = `https://api2.cursor.sh/updates/api/update/${architecture.updatePlatform}/cursor/${probePkgver}/${machineHashPlaceholder}/${channel.releaseTrack}`;

  const response = await fetcher(updateUrl, {
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

async function checkDebAvailability(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch,
): Promise<UnavailableArtifact | null> {
  const url = createDebUrl(latest, architecture);

  try {
    const response = await fetcher(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok
      ? null
      : {
          architecture,
          url,
          reason: `HTTP ${response.status}`,
        };
  } catch (error: unknown) {
    return {
      architecture,
      url,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getLatestRelease(
  channel: ChannelConfig,
  fetcher: CursorFetch = defaultFetch,
): Promise<LatestRelease> {
  const releases = await Promise.all(
    Architecture.all.map(async (architecture) => ({
      architecture,
      latest: await getLatestVersion(channel, architecture, fetcher),
    })),
  );
  const reference = releases.find((release) => release.latest !== null)?.latest;

  if (!reference) return { status: "unavailable", releases };

  const mismatch = releases.some(
    (release) =>
      release.latest === null ||
      release.latest.upstreamPkgver !== reference.upstreamPkgver ||
      release.latest.commit !== reference.commit,
  );
  if (mismatch) return { status: "architecture-mismatch", releases };

  const artifactChecks = await Promise.all(
    Architecture.all.map((architecture) =>
      checkDebAvailability(reference, architecture, fetcher),
    ),
  );
  const artifacts: UnavailableArtifact[] = [];
  for (const artifact of artifactChecks) {
    if (artifact) artifacts.push(artifact);
  }

  return artifacts.length > 0
    ? {
        status: "artifact-unavailable",
        latest: reference,
        artifacts,
      }
    : {
        status: "available",
        latest: reference,
      };
}

export async function computeDebSha512(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch = defaultFetch,
) {
  const response = await fetcher(createDebUrl(latest, architecture), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok || !response.body)
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);

  const hash = new CryptoHasher("sha512");
  return digestStream(response.body, hash);
}
