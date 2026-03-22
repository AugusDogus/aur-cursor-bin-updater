import type { ChannelKey } from "../schemas";

export interface ChannelConfig {
  releaseTrack: "dev" | "prerelease";
  defaultPkgbuild: string;
}

const channels: Record<ChannelKey, ChannelConfig> = {
  nightly: {
    releaseTrack: "dev",
    defaultPkgbuild: "packaging/nightly/PKGBUILD",
  },
  "early-access": {
    releaseTrack: "prerelease",
    defaultPkgbuild: "packaging/early-access/PKGBUILD",
  },
};

export function getChannelConfig(channel: ChannelKey) {
  return channels[channel];
}
