const architectures = [
  {
    pkgbuild: "x86_64",
    deb: "amd64",
    cursorPlatform: "x64",
    updatePlatform: "linux-x64",
  },
  {
    pkgbuild: "aarch64",
    deb: "arm64",
    cursorPlatform: "arm64",
    updatePlatform: "linux-arm64",
  },
] as const;

export type Architecture = (typeof architectures)[number];

export const Architecture = {
  all: architectures,
  sha512Field(architecture: Architecture) {
    return `sha512sums_${architecture.pkgbuild}`;
  },
} as const;
