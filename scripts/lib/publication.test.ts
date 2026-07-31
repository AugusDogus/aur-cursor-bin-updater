import { describe, expect, test } from "bun:test";

import type {
  CurrentVersion,
  LatestVersion,
  PublicationDecision as PublicationDecisionValue,
} from "../schemas";
import {
  LatestRelease,
  type LatestRelease as LatestReleaseValue,
} from "./cursor-api";
import { PublicationDecision, PublicationPlan } from "./publication";

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

const noUnavailableArtifacts = {
  x86_64: null,
  aarch64: null,
} as const;

describe("PublicationDecision.fromRelease", () => {
  test("distinguishes an update from an aligned current release", () => {
    const available = LatestRelease.fromArchitectureResults(
      { x86_64: latest, aarch64: latest },
      noUnavailableArtifacts,
    );
    expect(
      PublicationDecision.fromRelease(current, available),
    ).toEqual({
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
        LatestRelease.fromArchitectureResults(
          { x86_64: currentRelease, aarch64: currentRelease },
          noUnavailableArtifacts,
        ),
      ),
    ).toEqual({ status: "up-to-date" });
  });

  test.each([
    [
      LatestRelease.fromArchitectureResults(
        { x86_64: null, aarch64: null },
        noUnavailableArtifacts,
      ),
      "release-unavailable",
    ],
    [
      LatestRelease.fromArchitectureResults(
        { x86_64: latest, aarch64: null },
        noUnavailableArtifacts,
      ),
      "architecture-mismatch",
    ],
    [
      LatestRelease.fromArchitectureResults(
        { x86_64: latest, aarch64: latest },
        {
          x86_64: null,
          aarch64: {
            url: "https://example.invalid/arm64.deb",
            reason: "HTTP 404",
          },
        },
      ),
      "artifact-unavailable",
    ],
  ] satisfies ReadonlyArray<
    readonly [LatestReleaseValue, PublicationDecisionValue["status"]]
  >)(
    "maps non-publishable releases to one state",
    (release, expected) => {
      const decision = PublicationDecision.fromRelease(current, release);
      expect(decision.status).toBe(expected);
      if ("message" in decision) {
        expect(decision.message.length).toBeGreaterThan(0);
      }
    },
  );
});

describe("PublicationPlan.fromRelease", () => {
  const release = LatestRelease.fromArchitectureResults(
    { x86_64: latest, aarch64: latest },
    noUnavailableArtifacts,
  );

  test("derives one atomic workflow plan", () => {
    expect(PublicationPlan.fromRelease(current, release, false)).toEqual({
      status: "update-and-publish",
      latest,
      package: {
        pkgver: latest.pkgver,
        upstream_pkgver: latest.upstreamPkgver,
        commit: latest.commit,
      },
    });
    expect(PublicationPlan.fromRelease(current, release, true)).toEqual({
      status: "publish-current",
      package: {
        pkgver: current.pkgver,
        upstream_pkgver: current.upstreamPkgver,
        commit: current.commit,
      },
    });
  });
});
