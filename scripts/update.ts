import process from "node:process";
import { write } from "bun";

import { parseCliOptions, getUsageText } from "./lib/cli";
import { Architecture } from "./lib/architecture";
import { getChannelConfig } from "./lib/channels";
import {
  computeDebSha512,
  getLatestRelease,
  LatestRelease,
} from "./lib/cursor-api";
import { generateSrcinfo, parseCurrentVersion, updatePkgbuild } from "./lib/pkgbuild";
import { PublicationDecision } from "./lib/publication";
import { checkResultSchema } from "./schemas";

try {
  const options = parseCliOptions(process.argv.slice(2));
  const channel = getChannelConfig(options.channel);

  if (options.mode === "srcinfo") {
    await write(options.srcinfoPath, await generateSrcinfo(options.pkgbuildPath));
    console.error(`Generated ${options.srcinfoPath}`);
    process.exit(0);
  }

  const current = await parseCurrentVersion(options.pkgbuildPath);
  const release = await getLatestRelease(channel);
  const publication = PublicationDecision.fromRelease(current, release);

  const result = checkResultSchema.parse({
    channel: options.channel,
    current: {
      pkgver: current.pkgver,
      upstream_pkgver: current.upstreamPkgver,
      commit: current.commit,
    },
    publication,
  });

  if (options.mode === "check") {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (release.status !== "available") {
    console.error(LatestRelease.message(release));
    process.exit(2);
  }
  if (publication.status !== "update-available") {
    console.error("Already up to date.");
    process.exit(2);
  }

  const checksums = await Architecture.mapValues(
    async (architecture) =>
      options.skipChecksum
        ? "SKIP"
        : await computeDebSha512(release.latest, architecture),
  );
  await updatePkgbuild(options.pkgbuildPath, release.latest, checksums);
  console.error(
    `Updated ${options.pkgbuildPath} -> ${release.latest.upstreamPkgver} (${release.latest.commit.slice(0, 8)})`,
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === getUsageText()) console.error(getUsageText());
  else console.error(`ERROR: ${message}`);
  process.exit(1);
}
