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

type ArchitectureEntry<Value> = {
  architecture: Architecture;
  value: Value;
};

export class ArchitectureValues<Value> {
  readonly #values = new Map<
    Architecture["pkgbuild"],
    { value: Value }
  >();

  private constructor(entries: readonly ArchitectureEntry<Value>[]) {
    for (const entry of entries) {
      this.#values.set(entry.architecture.pkgbuild, {
        value: entry.value,
      });
    }
  }

  static from<Value>(
    mapper: (architecture: Architecture) => Value,
  ): ArchitectureValues<Value> {
    return new ArchitectureValues(
      architectures.map((architecture) => ({
        architecture,
        value: mapper(architecture),
      })),
    );
  }

  static async fromAsync<Value>(
    mapper: (architecture: Architecture) => Promise<Value>,
  ): Promise<ArchitectureValues<Value>> {
    return new ArchitectureValues(
      await Promise.all(
        architectures.map(async (architecture) => ({
          architecture,
          value: await mapper(architecture),
        })),
      ),
    );
  }

  get(architecture: Architecture): Value {
    const entry = this.#values.get(architecture.pkgbuild);
    if (entry === undefined) {
      throw new Error(
        `Missing value for supported architecture ${architecture.pkgbuild}`,
      );
    }
    return entry.value;
  }

  entries(): readonly ArchitectureEntry<Value>[] {
    return architectures.map((architecture) => ({
      architecture,
      value: this.get(architecture),
    }));
  }
}

export const Architecture = {
  all: architectures,
  values: ArchitectureValues.from,
  mapValues: ArchitectureValues.fromAsync,
  sha512Field(architecture: Architecture) {
    return `sha512sums_${architecture.pkgbuild}`;
  },
} as const;
