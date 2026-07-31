import { z } from "zod";

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
export type ChannelTarget = {
  [Key in ChannelKey]: {
    channel: Key;
    pkgbuild_path: (typeof channels)[Key]["defaultPkgbuild"];
    aur_package: (typeof channels)[Key]["aurPackage"];
  };
}[ChannelKey];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const channelKeySchema = z.custom<ChannelKey>(
  (value) => typeof value === "string" && Object.hasOwn(channels, value),
  "Expected a configured release channel",
);

export const channelTargetSchema = z.custom<ChannelTarget>((value) => {
  if (!isRecord(value)) return false;
  const parsedChannel = channelKeySchema.safeParse(value.channel);
  if (!parsedChannel.success) return false;
  const config = channels[parsedChannel.data];
  return (
    value.pkgbuild_path === config.defaultPkgbuild &&
    value.aur_package === config.aurPackage
  );
}, "Expected a configured channel target");

export function getChannelConfig<Key extends ChannelKey>(channel: Key) {
  return channels[channel];
}

export function getChannelTarget(channel: ChannelKey) {
  const config = getChannelConfig(channel);
  return channelTargetSchema.parse({
    channel,
    pkgbuild_path: config.defaultPkgbuild,
    aur_package: config.aurPackage,
  });
}
