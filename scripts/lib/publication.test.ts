import { describe, expect, test } from "bun:test";

import {
  preparationResultSchema,
  type CurrentVersion,
  type LatestVersion,
} from "../schemas";
import { Architecture } from "./architecture";
import { PublicationPlan } from "./publication";
import {
  Release,
  type ArtifactAvailability,
  type Release as ReleaseValue,
} from "./release";

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
};

function getRelease(options?: {
  x86_64?: LatestVersion | null;
  aarch64?: LatestVersion | null;
  unavailableArtifact?: "x86_64" | "aarch64";
}): ReleaseValue {
  const x86_64 = options?.x86_64 === undefined ? latest : options.x86_64;
  const aarch64 = options?.aarch64 === undefined ? latest : options.aarch64;
  const alignment = Release.align(
    Architecture.values((architecture) =>
      architecture.pkgbuild === "x86_64" ? x86_64 : aarch64,
    ),
  );
  if (alignment.status !== "aligned") return alignment;
  const unavailable = (
    architecture: "x86_64" | "aarch64",
  ): ArtifactAvailability =>
    options?.unavailableArtifact === architecture
      ? {
          status: "unavailable",
          url: `https://example.invalid/${architecture}.deb`,
          reason: "HTTP 404",
        }
      : { status: "available" };
  return Release.afterArtifactChecks(
    alignment,
    Architecture.values((architecture) =>
      unavailable(architecture.pkgbuild),
    ),
  );
}

describe("PublicationPlan", () => {
  test("distinguishes an update from an aligned current release", () => {
    const available = getRelease();
    expect(
      PublicationPlan.toDecision(
        PublicationPlan.fromRelease(current, available),
      ),
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
      PublicationPlan.toDecision(
        PublicationPlan.fromRelease(
          current,
          getRelease({
            x86_64: currentRelease,
            aarch64: currentRelease,
          }),
        ),
      ),
    ).toEqual({ status: "up-to-date" });
  });

  test("maps non-publishable releases to one state", () => {
    const releases = [
      [
        getRelease({ x86_64: null, aarch64: null }),
        "release-unavailable",
      ],
      [
        getRelease({ x86_64: latest, aarch64: null }),
        "architecture-mismatch",
      ],
      [
        getRelease({ unavailableArtifact: "aarch64" }),
        "artifact-unavailable",
      ],
    ] as const;

    for (const [release, expected] of releases) {
      const decision = PublicationPlan.toDecision(
        PublicationPlan.fromRelease(current, release),
      );
      expect(decision.status).toBe(expected);
      if ("message" in decision) {
        expect(decision.message.length).toBeGreaterThan(0);
      }
    }
  });

  test("derives and serializes one atomic workflow plan", () => {
    const release = getRelease();
    const updatePlan = PublicationPlan.fromRelease(current, release);
    expect(updatePlan).toEqual({
      status: "update-and-publish",
      latest,
    });
    expect(PublicationPlan.toDto(updatePlan)).toEqual({
      status: "update-and-publish",
      package: {
        pkgver: latest.pkgver,
        upstream_pkgver: latest.upstreamPkgver,
        commit: latest.commit,
      },
    });

    const currentPlan = PublicationPlan.publishCurrent(current);
    expect(PublicationPlan.toDto(currentPlan)).toEqual({
      status: "publish-current",
      package: {
        pkgver: current.pkgver,
        upstream_pkgver: current.upstreamPkgver,
        commit: current.commit,
      },
    });
  });

  test("plans force, drift, and observation failures in one policy", () => {
    expect(
      PublicationPlan.prepare(current, { status: "forced" }),
    ).toEqual({
      status: "planned",
      plan: PublicationPlan.publishCurrent(current),
    });

    const release = getRelease({
      x86_64: {
        ...latest,
        pkgver: current.pkgver,
        upstreamPkgver: current.upstreamPkgver,
        commit: current.commit,
      },
      aarch64: {
        ...latest,
        pkgver: current.pkgver,
        upstreamPkgver: current.upstreamPkgver,
        commit: current.commit,
      },
    });
    expect(
      PublicationPlan.prepare(current, {
        status: "observed",
        aur: { status: "drifted" },
        release: { status: "observed", value: release },
      }),
    ).toEqual({
      status: "planned",
      plan: PublicationPlan.publishCurrent(current),
    });

    const releaseError = new Error("release unavailable");
    expect(
      PublicationPlan.prepare(current, {
        status: "observed",
        aur: { status: "current" },
        release: { status: "failed", error: releaseError },
      }),
    ).toEqual({
      status: "failed",
      errors: [releaseError],
    });
  });

  test("rejects a channel paired with another package target", () => {
    expect(() =>
      preparationResultSchema.parse({
        target: {
          channel: "nightly",
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
