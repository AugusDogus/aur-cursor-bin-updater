import { z } from "zod";

const channelKeys = ["nightly", "early-access"] as const;

export const channelKeySchema = z.enum(channelKeys);
export type ChannelKey = (typeof channelKeys)[number];

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
} as const satisfies Record<ChannelKey, ChannelConfig>;

export const channelTargetSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("nightly"),
    pkgbuild_path: z.literal(channels.nightly.defaultPkgbuild),
    aur_package: z.literal(channels.nightly.aurPackage),
  }),
  z.object({
    channel: z.literal("early-access"),
    pkgbuild_path: z.literal(channels["early-access"].defaultPkgbuild),
    aur_package: z.literal(channels["early-access"].aurPackage),
  }),
]);

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
