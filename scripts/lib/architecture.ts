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
export type ArchitectureValues<Value> = {
  readonly [Key in Architecture["pkgbuild"]]: Value;
};

export const Architecture = {
  all: architectures,
  async mapValues<Value>(
    mapper: (architecture: Architecture) => Promise<Value>,
  ): Promise<ArchitectureValues<Value>> {
    const [x86_64, aarch64] = await Promise.all([
      mapper(architectures[0]),
      mapper(architectures[1]),
    ]);
    return { x86_64, aarch64 };
  },
  sha512Field(architecture: Architecture) {
    return `sha512sums_${architecture.pkgbuild}`;
  },
} as const;
