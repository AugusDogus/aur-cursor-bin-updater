import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { file, write } from "bun";

import type { ChannelTarget } from "./channels";
import { getLocalSourceChecksumFailures } from "./local-source-checksums";
import { generateSrcinfo } from "./pkgbuild";

export const aurStagingDirectory = ".aur";
export const aurPublishManifestName = ".publish-manifest";

export type AurPackageFile = {
  filename: string;
  mode: "644" | "755";
  content: string;
  validation: "pkgbuild" | "local-source" | "none";
};

export async function getAurPackageFiles(
  target: ChannelTarget,
): Promise<readonly AurPackageFile[]> {
  return [
    {
      filename: "PKGBUILD",
      mode: "644",
      content: await file(target.pkgbuild_path).text(),
      validation: "pkgbuild",
    },
    {
      filename: ".SRCINFO",
      mode: "644",
      content: await generateSrcinfo(target.pkgbuild_path),
      validation: "none",
    },
    {
      filename: "cursor.desktop",
      mode: "644",
      content: await file("packaging/common/cursor.desktop").text(),
      validation: "local-source",
    },
    {
      filename: "cursor-launcher.sh",
      mode: "755",
      content: await file(
        "packaging/common/cursor-launcher.sh",
      ).text(),
      validation: "local-source",
    },
  ];
}

export function serializeAurPublishManifest(
  files: readonly AurPackageFile[],
) {
  return `${files
    .map(({ filename, mode }) => `${mode}\t${filename}`)
    .join("\n")}\n`;
}

export async function stageAurPackage(target: ChannelTarget) {
  const files = await getAurPackageFiles(target);
  await mkdir(aurStagingDirectory, { recursive: true });
  await Promise.all(
    files.map(async ({ filename, mode, content }) => {
      const stagedPath = join(aurStagingDirectory, filename);
      await write(stagedPath, content);
      await chmod(stagedPath, mode === "755" ? 0o755 : 0o644);
    }),
  );
  await write(
    join(aurStagingDirectory, aurPublishManifestName),
    serializeAurPublishManifest(files),
  );

  const pkgbuildFiles = files.filter(
    ({ validation }) => validation === "pkgbuild",
  );
  if (pkgbuildFiles.length !== 1) {
    throw new Error(
      `AUR manifest must declare exactly one PKGBUILD, found ${pkgbuildFiles.length}`,
    );
  }
  const pkgbuildFile = pkgbuildFiles[0];
  if (pkgbuildFile === undefined) {
    throw new Error("AUR manifest does not declare a PKGBUILD");
  }
  const checksumFailures = await getLocalSourceChecksumFailures(
    join(aurStagingDirectory, pkgbuildFile.filename),
    files
      .filter(({ validation }) => validation === "local-source")
      .map(({ filename }) => join(aurStagingDirectory, filename)),
  );
  if (checksumFailures.length > 0) {
    throw new Error(
      `Staged AUR checksum validation failed:\n${checksumFailures.join("\n")}`,
    );
  }
}
