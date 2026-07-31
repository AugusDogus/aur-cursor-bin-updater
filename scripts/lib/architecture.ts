const architectureByPkgbuild = {
  x86_64: {
    pkgbuild: "x86_64",
    deb: "amd64",
    cursorPlatform: "x64",
    updatePlatform: "linux-x64",
  },
  aarch64: {
    pkgbuild: "aarch64",
    deb: "arm64",
    cursorPlatform: "arm64",
    updatePlatform: "linux-arm64",
  },
} as const;

export type Architecture =
  (typeof architectureByPkgbuild)[keyof typeof architectureByPkgbuild];
export type ArchitectureValues<Value> = {
  readonly [Key in keyof typeof architectureByPkgbuild]: Value;
};

export const Architecture = {
  all: [
    architectureByPkgbuild.x86_64,
    architectureByPkgbuild.aarch64,
  ],
  async mapValues<Value>(
    mapper: (architecture: Architecture) => Promise<Value>,
  ): Promise<ArchitectureValues<Value>> {
    const [x86_64, aarch64] = await Promise.all([
      mapper(architectureByPkgbuild.x86_64),
      mapper(architectureByPkgbuild.aarch64),
    ]);
    return { x86_64, aarch64 };
  },
  sha512Field(architecture: Architecture) {
    return `sha512sums_${architecture.pkgbuild}`;
  },
} as const;
