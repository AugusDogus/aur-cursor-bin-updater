import { describe, expect, test } from "bun:test";

import type { CliCommand } from "./cli";
import { Architecture } from "./architecture";
import { getChannelTarget } from "./channels";
import { parseCurrentVersion } from "./pkgbuild";
import { Release } from "./release";
import {
  preparePublication,
  type PrepareDependencies,
} from "./update-operations";

const command: Extract<CliCommand, { mode: "prepare" }> = {
  mode: "prepare",
  target: getChannelTarget("early-access"),
  skipChecksum: false,
  forcePublish: false,
};

async function getCurrentRelease() {
  const current = await parseCurrentVersion(
    command.target.pkgbuild_path,
  );
  const latest = {
    pkgver: current.pkgver,
    upstreamPkgver: current.upstreamPkgver,
    commit: current.commit,
  };
  const alignment = Release.align(
    Architecture.values(() => latest),
  );
  if (alignment.status !== "aligned") {
    throw new Error("Expected aligned test release");
  }
  return Release.afterArtifactChecks(
    alignment,
    Architecture.values(() => ({ status: "available" })),
  );
}

function dependencies(
  release: Awaited<ReturnType<typeof getCurrentRelease>>,
  aurCurrent: boolean,
): PrepareDependencies {
  return {
    getLatestRelease: async () => release,
    computeDebSha512: async () => {
      throw new Error("Checksums should not be computed");
    },
    isAurPackageCurrent: async () => aurCurrent,
    updatePkgbuild: async () => {
      throw new Error("PKGBUILD should not be updated");
    },
  };
}

describe("preparePublication", () => {
  test("force publication does not discover a release", async () => {
    const unavailableDependencies: PrepareDependencies = {
      getLatestRelease: async () => {
        throw new Error("Release discovery should not run");
      },
      computeDebSha512: async () => {
        throw new Error("Checksums should not be computed");
      },
      isAurPackageCurrent: async () => {
        throw new Error("AUR comparison should not run");
      },
      updatePkgbuild: async () => {
        throw new Error("PKGBUILD should not be updated");
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

  test("reconciles AUR drift without release discovery", async () => {
    const result = await preparePublication(command, {
      getLatestRelease: async () => {
        throw new Error("Cursor API is unavailable");
      },
      computeDebSha512: async () => {
        throw new Error("Checksums should not be computed");
      },
      isAurPackageCurrent: async () => false,
      updatePkgbuild: async () => {
        throw new Error("PKGBUILD should not be updated");
      },
    });

    expect(result.plan.status).toBe("publish-current");
  });

  test("reports release discovery errors when AUR is current", async () => {
    expect(
      preparePublication(command, {
        getLatestRelease: async () => {
          throw new Error("Cursor API is unavailable");
        },
        computeDebSha512: async () => {
          throw new Error("Checksums should not be computed");
        },
        isAurPackageCurrent: async () => true,
        updatePkgbuild: async () => {
          throw new Error("PKGBUILD should not be updated");
        },
      }),
    ).rejects.toThrow("Cursor API is unavailable");
  });

  test("prefers a newer release when AUR has drifted", async () => {
    const newer = {
      pkgver: "99.0.0",
      upstreamPkgver: "99.0.0",
      commit: "9999999999999999999999999999999999999999",
    };
    const alignment = Release.align(
      Architecture.values(() => newer),
    );
    if (alignment.status !== "aligned") {
      throw new Error("Expected aligned test release");
    }
    const release = Release.afterArtifactChecks(
      alignment,
      Architecture.values(() => ({ status: "available" })),
    );
    let appliedVersion = "";

    const result = await preparePublication(
      { ...command, skipChecksum: true },
      {
        getLatestRelease: async () => release,
        computeDebSha512: async () => {
          throw new Error("Checksums should be skipped");
        },
        isAurPackageCurrent: async () => false,
        updatePkgbuild: async (_path, latest) => {
          appliedVersion = latest.pkgver;
        },
      },
    );

    expect(result.plan.status).toBe("update-and-publish");
    expect(appliedVersion).toBe(newer.pkgver);
  });
});
