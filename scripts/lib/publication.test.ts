import { describe, expect, test } from "bun:test";

import {
  preparationResultSchema,
  type CurrentVersion,
  type LatestVersion,
} from "../schemas";
import type { ChannelConfig } from "./channels";
import { getLatestRelease } from "./cursor-api";
import {
  PublicationDecision,
  PublicationExecution,
} from "./publication";

const channel: ChannelConfig = {
  releaseTrack: "dev",
  defaultPkgbuild: "packaging/nightly/PKGBUILD",
  aurPackage: "cursor-nightly-bin",
};
const currentCommit = "1111111111111111111111111111111111111111";
const latestCommit = "2222222222222222222222222222222222222222";
const current: CurrentVersion = {
  pkgver: "1.0.0",
  upstreamPkgver: "1.0.0",
  commit: currentCommit,
};
const latest: LatestVersion = {
  pkgver: "2.0.0",
  upstreamPkgver: "2.0.0",
  commit: latestCommit,
  downloadUrl: `https://downloads.cursor.com/production/${latestCommit}/linux/x64/Cursor-2.0.0.AppImage.zsync`,
};

function updateResponse(
  platform: "x64" | "arm64",
  version: string,
  commit: string,
) {
  return new Response(
    JSON.stringify({
      version,
      url: `https://downloads.cursor.com/production/${commit}/linux/${platform}/Cursor-${version}.AppImage.zsync`,
    }),
    { status: 200 },
  );
}

async function getRelease(options?: {
  x86_64?: LatestVersion | null;
  aarch64?: LatestVersion | null;
  unavailableArtifact?: "x86_64" | "aarch64";
}) {
  const x86_64 = options?.x86_64 === undefined ? latest : options.x86_64;
  const aarch64 = options?.aarch64 === undefined ? latest : options.aarch64;

  return getLatestRelease(channel, async (input, init) => {
    const url = input.toString();
    const architecture = url.includes("arm64") ? "aarch64" : "x86_64";
    if (init?.method === "HEAD") {
      return new Response(null, {
        status: options?.unavailableArtifact === architecture ? 404 : 200,
      });
    }

    const release = architecture === "aarch64" ? aarch64 : x86_64;
    if (release === null) return new Response(null, { status: 204 });
    return updateResponse(
      architecture === "aarch64" ? "arm64" : "x64",
      release.upstreamPkgver,
      release.commit,
    );
  });
}

describe("PublicationDecision.fromRelease", () => {
  test("distinguishes an update from an aligned current release", async () => {
    const available = await getRelease();
    expect(PublicationDecision.fromRelease(current, available)).toEqual({
      status: "update-available",
      latest: {
        pkgver: latest.pkgver,
        upstream_pkgver: latest.upstreamPkgver,
        commit: latest.commit,
      },
    });

    const currentRelease: LatestVersion = {
      ...latest,
      pkgver: current.pkgver,
      upstreamPkgver: current.upstreamPkgver,
      commit: current.commit,
    };
    expect(
      PublicationDecision.fromRelease(
        current,
        await getRelease({
          x86_64: currentRelease,
          aarch64: currentRelease,
        }),
      ),
    ).toEqual({ status: "up-to-date" });
  });

  test("maps non-publishable releases to one state", async () => {
    const releases = [
      [
        await getRelease({ x86_64: null, aarch64: null }),
        "release-unavailable",
      ],
      [
        await getRelease({ x86_64: latest, aarch64: null }),
        "architecture-mismatch",
      ],
      [
        await getRelease({ unavailableArtifact: "aarch64" }),
        "artifact-unavailable",
      ],
    ] as const;

    for (const [release, expected] of releases) {
      const decision = PublicationDecision.fromRelease(current, release);
      expect(decision.status).toBe(expected);
      if ("message" in decision) {
        expect(decision.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("PublicationExecution", () => {
  test("derives and serializes one atomic workflow plan", async () => {
    const release = await getRelease();
    const updateExecution = PublicationExecution.fromRelease(
      current,
      release,
      false,
    );
    expect(updateExecution).toEqual({
      status: "update-and-publish",
      latest,
      package: {
        pkgver: latest.pkgver,
        upstream_pkgver: latest.upstreamPkgver,
        commit: latest.commit,
      },
    });
    expect(PublicationExecution.toDto(updateExecution)).toEqual({
      status: "update-and-publish",
      package: {
        pkgver: latest.pkgver,
        upstream_pkgver: latest.upstreamPkgver,
        commit: latest.commit,
      },
    });

    const currentExecution = PublicationExecution.fromRelease(
      current,
      release,
      true,
    );
    expect(PublicationExecution.toDto(currentExecution)).toEqual({
      status: "publish-current",
      package: {
        pkgver: current.pkgver,
        upstream_pkgver: current.upstreamPkgver,
        commit: current.commit,
      },
    });
  });

  test("rejects a channel paired with another package target", () => {
    expect(() =>
      preparationResultSchema.parse({
        channel: "nightly",
        target: {
          pkgbuild_path: "packaging/early-access/PKGBUILD",
          aur_package: "cursor-early-access-bin",
        },
        plan: {
          status: "publish-current",
          package: {
            pkgver: current.pkgver,
            upstream_pkgver: current.upstreamPkgver,
            commit: current.commit,
          },
        },
      }),
    ).toThrow();
  });
});
