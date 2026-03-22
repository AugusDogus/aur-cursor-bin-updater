import process from "node:process";
import { write } from "bun";

import { parseCliOptions, getUsageText } from "./lib/cli";
import { getChannelConfig } from "./lib/channels";
import { computeDebSha512, getLatestVersion } from "./lib/cursor-api";
import { generateSrcinfo, parseCurrentVersion, updatePkgbuild } from "./lib/pkgbuild";
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
  const latest = await getLatestVersion(channel);
  const latestUpstreamPkgver = latest?.upstreamPkgver ?? current.upstreamPkgver;
  const latestPkgver = latest?.pkgver ?? current.pkgver;
  const latestCommit = latest?.commit ?? current.commit;
  const updateAvailable =
    latest !== null &&
    (current.upstreamPkgver !== latest.upstreamPkgver ||
      current.commit !== latest.commit);

  const result = checkResultSchema.parse({
    channel: options.channel,
    current_pkgver: current.pkgver,
    current_upstream_pkgver: current.upstreamPkgver,
    current_commit: current.commit,
    latest_pkgver: latestPkgver,
    latest_upstream_pkgver: latestUpstreamPkgver,
    latest_commit: latestCommit,
    update_available: updateAvailable,
  });

  if (options.mode === "check") {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!latest) {
    console.error("No update payload available for this channel (HTTP 204).");
    process.exit(2);
  }
  if (!updateAvailable) {
    console.error("Already up to date.");
    process.exit(2);
  }

  const sha512 = options.skipChecksum ? "SKIP" : await computeDebSha512(latest);
  await updatePkgbuild(options.pkgbuildPath, latest, sha512);
  console.error(
    `Updated ${options.pkgbuildPath} -> ${latest.upstreamPkgver} (${latest.commit.slice(0, 8)})`,
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === getUsageText()) console.error(getUsageText());
  else console.error(`ERROR: ${message}`);
  process.exit(1);
}
