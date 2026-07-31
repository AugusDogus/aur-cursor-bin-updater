export interface ChannelConfig {
  releaseTrack: "dev" | "prerelease";
  defaultPkgbuild: string;
  aurPackage: "cursor-nightly-bin" | "cursor-early-access-bin";
}

export const channels = {
  nightly: {
    releaseTrack: "dev",
    defaultPkgbuild: "packaging/nightly/PKGBUILD",
    aurPackage: "cursor-nightly-bin",
  },
  "early-access": {
    releaseTrack: "prerelease",
    defaultPkgbuild: "packaging/early-access/PKGBUILD",
    aurPackage: "cursor-early-access-bin",
  },
} as const satisfies Record<string, ChannelConfig>;

export type ChannelKey = keyof typeof channels;

export function getChannelConfig<Key extends ChannelKey>(channel: Key) {
  return channels[channel];
}
