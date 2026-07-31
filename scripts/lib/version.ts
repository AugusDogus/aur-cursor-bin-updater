import type {
  CurrentVersion,
  VersionSummary,
} from "../schemas";

export function summarizeVersion(
  version: Pick<
    CurrentVersion,
    "pkgver" | "upstreamPkgver" | "commit"
  >,
): VersionSummary {
  return {
    pkgver: version.pkgver,
    upstream_pkgver: version.upstreamPkgver,
    commit: version.commit,
  };
}
