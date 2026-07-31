import { describe, expect, test } from "bun:test";

import type { CliCommand } from "./cli";
import { parseCurrentVersion } from "./pkgbuild";
import { Release } from "./release";
import {
  preparePublication,
  type UpdateDependencies,
} from "./update-operations";

const command: Extract<CliCommand, { mode: "prepare" }> = {
  mode: "prepare",
  channel: "early-access",
  pkgbuildPath: "packaging/early-access/PKGBUILD",
  skipChecksum: false,
  forcePublish: false,
};

async function getCurrentRelease() {
  const current = await parseCurrentVersion(command.pkgbuildPath);
  const latest = {
    pkgver: current.pkgver,
    upstreamPkgver: current.upstreamPkgver,
    commit: current.commit,
  };
  const alignment = Release.align({
    x86_64: latest,
    aarch64: latest,
  });
  if (alignment.status !== "aligned") {
    throw new Error("Expected aligned test release");
  }
  return Release.afterArtifactChecks(alignment, {
    x86_64: { status: "available" },
    aarch64: { status: "available" },
  });
}

function dependencies(
  release: Awaited<ReturnType<typeof getCurrentRelease>>,
  aurCurrent: boolean,
): UpdateDependencies {
  return {
    getLatestRelease: async () => release,
    computeDebSha512: async () => {
      throw new Error("Checksums should not be computed");
    },
    isAurPackageCurrent: async () => aurCurrent,
  };
}

describe("preparePublication", () => {
  test("force publication does not discover a release", async () => {
    const unavailableDependencies: UpdateDependencies = {
      getLatestRelease: async () => {
        throw new Error("Release discovery should not run");
      },
      computeDebSha512: async () => {
        throw new Error("Checksums should not be computed");
      },
      isAurPackageCurrent: async () => {
        throw new Error("AUR comparison should not run");
      },
    };

    const result = await preparePublication(
      { ...command, forcePublish: true },
      unavailableDependencies,
    );
    expect(result.plan.status).toBe("publish-current");
  });

  test("reconciles AUR drift for an otherwise current release", async () => {
    const release = await getCurrentRelease();
    const drifted = await preparePublication(
      command,
      dependencies(release, false),
    );
    expect(drifted.plan.status).toBe("publish-current");

    const aligned = await preparePublication(
      command,
      dependencies(release, true),
    );
    expect(aligned.plan).toEqual({
      status: "skip",
      publication: { status: "up-to-date" },
    });
  });
});
