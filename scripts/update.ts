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
import { PublicationDecision, PublicationPlan } from "./lib/publication";
import { checkResultSchema, preparationResultSchema } from "./schemas";

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

  if (options.mode === "check") {
    const result = checkResultSchema.parse({
      channel: options.channel,
      current: {
        pkgver: current.pkgver,
        upstream_pkgver: current.upstreamPkgver,
        commit: current.commit,
      },
      publication: PublicationDecision.fromRelease(current, release),
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const plan = PublicationPlan.fromRelease(
    current,
    release,
    options.mode === "prepare" && options.forcePublish,
  );

  if (plan.status === "update-and-publish") {
    const checksums = await Architecture.mapValues(
      async (architecture) =>
        options.skipChecksum
          ? "SKIP"
          : await computeDebSha512(plan.latest, architecture),
    );
    await updatePkgbuild(options.pkgbuildPath, plan.latest, checksums);
  }

  if (options.mode === "prepare") {
    const result = preparationResultSchema.parse({
      channel: options.channel,
      plan,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (plan.status === "skip") {
    console.error(
      release.status === "available"
        ? "Already up to date."
        : LatestRelease.message(release),
    );
    process.exit(2);
  }
  if (plan.status === "publish-current") {
    throw new Error("Update mode cannot force publication");
  }

  console.error(
    `Updated ${options.pkgbuildPath} -> ${plan.latest.upstreamPkgver} (${plan.latest.commit.slice(0, 8)})`,
  );
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === getUsageText()) console.error(getUsageText());
  else console.error(`ERROR: ${message}`);
  process.exit(1);
}
