import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { file, write } from "bun";

import type { ChannelTarget } from "./channels";
import { generateSrcinfo } from "./pkgbuild";

export const aurStagingDirectory = ".aur";
export const aurPublishManifestName = ".publish-manifest";

export type AurPackageFile = {
  filename: string;
  mode: "644" | "755";
  content: string;
};

export async function getAurPackageFiles(
  target: ChannelTarget,
): Promise<readonly AurPackageFile[]> {
  return [
    {
      filename: "PKGBUILD",
      mode: "644",
      content: await file(target.pkgbuild_path).text(),
    },
    {
      filename: ".SRCINFO",
      mode: "644",
      content: await generateSrcinfo(target.pkgbuild_path),
    },
    {
      filename: "cursor.desktop",
      mode: "644",
      content: await file("packaging/common/cursor.desktop").text(),
    },
    {
      filename: "cursor-launcher.sh",
      mode: "755",
      content: await file(
        "packaging/common/cursor-launcher.sh",
      ).text(),
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
}
