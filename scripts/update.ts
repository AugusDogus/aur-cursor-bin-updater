import process from "node:process";
import { write } from "bun";

import { getUsageText, parseCliOptions } from "./lib/cli";
import {
  checkForUpdate,
  generateChannelSrcinfo,
  preparePublication,
  updatePackage,
} from "./lib/update-operations";

async function main() {
  const command = parseCliOptions(process.argv.slice(2));
  switch (command.mode) {
    case "check":
      console.log(JSON.stringify(await checkForUpdate(command), null, 2));
      return 0;
    case "prepare":
      console.log(JSON.stringify(await preparePublication(command), null, 2));
      return 0;
    case "srcinfo":
      await write(command.srcinfoPath, await generateChannelSrcinfo(command));
      console.error(`Generated ${command.srcinfoPath}`);
      return 0;
    case "update": {
      const result = await updatePackage(command);
      if (result.status === "not-updated") {
        console.error(result.message);
        return 2;
      }
      console.error(
        `Updated ${command.pkgbuildPath} -> ${result.latest.upstreamPkgver} (${result.latest.commit.slice(0, 8)})`,
      );
      return 0;
    }
  }
}

try {
  process.exit(await main());
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === getUsageText()) console.error(getUsageText());
  else console.error(`ERROR: ${message}`);
  process.exit(1);
}
