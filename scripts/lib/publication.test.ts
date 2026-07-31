import { describe, expect, test } from "bun:test";

import type {
  CurrentVersion,
  LatestVersion,
  PublicationStatus as PublicationStatusValue,
} from "../schemas";
import { Architecture } from "./architecture";
import type { LatestRelease } from "./cursor-api";
import { PublicationStatus } from "./publication";

const current: CurrentVersion = {
  pkgver: "1.0.0",
  upstreamPkgver: "1.0.0",
  commit: "current-commit",
};

const latest: LatestVersion = {
  pkgver: "2.0.0",
  upstreamPkgver: "2.0.0",
  commit: "latest-commit",
  downloadUrl: "https://example.invalid",
};

describe("PublicationStatus.fromRelease", () => {
  test("distinguishes an update from an aligned current release", () => {
    expect(
      PublicationStatus.fromRelease(current, {
        status: "available",
        latest,
      }),
    ).toBe("update-available");
    expect(
      PublicationStatus.fromRelease(current, {
        status: "available",
        latest: {
          ...latest,
          pkgver: current.pkgver,
          upstreamPkgver: current.upstreamPkgver,
          commit: current.commit,
        },
      }),
    ).toBe("up-to-date");
  });

  test.each([
    [
      {
        status: "unavailable",
        releases: Architecture.all.map((architecture) => ({
          architecture,
          latest: null,
        })),
      },
      "release-unavailable",
    ],
    [
      {
        status: "architecture-mismatch",
        releases: Architecture.all.map((architecture) => ({
          architecture,
          latest: architecture.pkgbuild === "x86_64" ? latest : null,
        })),
      },
      "architecture-mismatch",
    ],
    [
      {
        status: "artifact-unavailable",
        latest,
        artifacts: [
          {
            architecture: Architecture.all[1],
            url: "https://example.invalid/arm64.deb",
            reason: "HTTP 404",
          },
        ],
      },
      "artifact-unavailable",
    ],
  ] satisfies ReadonlyArray<
    readonly [LatestRelease, PublicationStatusValue]
  >)(
    "maps non-publishable releases to one state",
    (release, expected) => {
      expect(PublicationStatus.fromRelease(current, release)).toBe(expected);
    },
  );
});
