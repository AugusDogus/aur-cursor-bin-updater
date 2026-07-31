import { CryptoHasher } from "bun";

import type { LatestVersion } from "../schemas";
import type { Architecture as ArchitectureDescriptor } from "./architecture";
import type { ArtifactAvailability } from "./release";

const USER_AGENT = "aur-cursor-bin-updater/1.0";

export type CursorFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const defaultFetch: CursorFetch = (input, init) => fetch(input, init);

export function createDebUrl(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
) {
  return `https://downloads.cursor.com/production/${latest.commit}/linux/${architecture.cursorPlatform}/deb/${architecture.deb}/deb/cursor_${latest.upstreamPkgver}_${architecture.deb}.deb`;
}

export async function checkDebAvailability(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch = defaultFetch,
): Promise<ArtifactAvailability> {
  const url = createDebUrl(latest, architecture);

  try {
    const response = await fetcher(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    return response.ok
      ? { status: "available" }
      : {
          status: "unavailable",
          url,
          reason: `HTTP ${response.status}`,
        };
  } catch (error: unknown) {
    return {
      status: "unavailable",
      url,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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

export async function computeDebSha512(
  latest: LatestVersion,
  architecture: ArchitectureDescriptor,
  fetcher: CursorFetch = defaultFetch,
) {
  const response = await fetcher(createDebUrl(latest, architecture), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  const hash = new CryptoHasher("sha512");
  return digestStream(response.body, hash);
}
