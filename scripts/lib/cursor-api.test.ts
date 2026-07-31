import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import type { LatestVersion } from "../schemas";
import { Architecture } from "./architecture";
import type { ChannelConfig } from "./channels";
import {
  computeDebSha512,
  createDebUrl,
  getLatestRelease,
} from "./cursor-api";

const channel: ChannelConfig = {
  releaseTrack: "dev",
  defaultPkgbuild: "PKGBUILD",
  aurPackage: "cursor-nightly-bin",
};

const commit = "0123456789abcdef0123456789abcdef01234567";

function updateResponse(
  platform: "x64" | "arm64",
  version = "9.9.9",
  releaseCommit = commit,
) {
  return new Response(
    JSON.stringify({
      version,
      url: `https://downloads.cursor.com/production/${releaseCommit}/linux/${platform}/Cursor-${version}.AppImage.zsync`,
    }),
    { status: 200 },
  );
}

describe("createDebUrl", () => {
  const latest: LatestVersion = {
    upstreamPkgver: "9.9.9",
    pkgver: "9.9.9",
    commit,
    downloadUrl: "https://example.invalid",
  };

  test("uses the centralized architecture descriptor", () => {
    expect(createDebUrl(latest, Architecture.all[0])).toBe(
      `https://downloads.cursor.com/production/${commit}/linux/x64/deb/amd64/deb/cursor_9.9.9_amd64.deb`,
    );
    expect(createDebUrl(latest, Architecture.all[1])).toBe(
      `https://downloads.cursor.com/production/${commit}/linux/arm64/deb/arm64/deb/cursor_9.9.9_arm64.deb`,
    );
  });
});

test("computeDebSha512 downloads and hashes the requested architecture", async () => {
  const latest: LatestVersion = {
    upstreamPkgver: "9.9.9",
    pkgver: "9.9.9",
    commit,
    downloadUrl: "https://example.invalid",
  };
  const requestedUrls: string[] = [];
  const checksum = await computeDebSha512(
    latest,
    Architecture.all[1],
    async (input) => {
      requestedUrls.push(input);
      return new Response("arm64 package");
    },
  );

  expect(requestedUrls).toEqual([
    expect.stringContaining("/linux/arm64/deb/arm64/"),
  ]);
  expect(checksum).toBe(
    createHash("sha512").update("arm64 package").digest("hex"),
  );
});

describe("getLatestRelease", () => {
  test("returns one release only when every architecture matches", async () => {
    const requestedUrls: string[] = [];
    const result = await getLatestRelease(channel, async (input, init) => {
      const url = input.toString();
      requestedUrls.push(url);
      if (init?.method === "HEAD") return new Response(null, { status: 200 });
      return url.includes("/linux-arm64/")
        ? updateResponse("arm64")
        : updateResponse("x64");
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.latest.upstreamPkgver).toBe("9.9.9");
    expect(requestedUrls).toContainEqual(
      expect.stringContaining("/linux-x64/"),
    );
    expect(requestedUrls).toContainEqual(
      expect.stringContaining("/linux-arm64/"),
    );
    expect(requestedUrls.filter((url) => url.endsWith(".deb"))).toHaveLength(2);
  });

  test("reports architecture metadata mismatches without publishing", async () => {
    const result = await getLatestRelease(channel, async (input) => {
      const url = input.toString();
      return url.includes("/linux-arm64/")
        ? updateResponse("arm64", "9.9.8")
        : updateResponse("x64", "9.9.9");
    });

    expect(result.status).toBe("architecture-mismatch");
  });

  test("reports when one architecture has not released yet", async () => {
    const result = await getLatestRelease(channel, async (input) => {
      const url = input.toString();
      return url.includes("/linux-arm64/")
        ? new Response(null, { status: 204 })
        : updateResponse("x64");
    });

    expect(result.status).toBe("architecture-mismatch");
  });

  test("reports delayed artifacts without publishing", async () => {
    const result = await getLatestRelease(channel, async (input, init) => {
      const url = input.toString();
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: url.includes("/arm64/") ? 404 : 200,
        });
      }
      return url.includes("/linux-arm64/")
        ? updateResponse("arm64")
        : updateResponse("x64");
    });

    expect(result.status).toBe("artifact-unavailable");
    if (result.status !== "artifact-unavailable") return;
    expect(result.artifacts).toEqual([
      {
        architecture: Architecture.all[1],
        url: expect.stringContaining("/arm64/"),
        reason: "HTTP 404",
      },
    ]);
  });

  test("reports when all update APIs have no release", async () => {
    const result = await getLatestRelease(
      channel,
      async () => new Response(null, { status: 204 }),
    );

    expect(result.status).toBe("unavailable");
  });

  test.each([
    ["9.9.9; touch /tmp/injected", commit],
    ["9.9.9\n_commit=bad", commit],
    ["9.9.9", "not-a-git-hash"],
  ])(
    "rejects shell-unsafe release metadata",
    async (version, releaseCommit) => {
      expect(
        getLatestRelease(channel, async (input) =>
          input.toString().includes("/linux-arm64/")
            ? updateResponse("arm64", version, releaseCommit)
            : updateResponse("x64", version, releaseCommit),
        ),
      ).rejects.toThrow();
    },
  );
});
