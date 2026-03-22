import { z } from "zod";

export const channelKeySchema = z.enum(["nightly", "early-access"]);

export const updateApiResponseSchema = z.looseObject({
	version: z.string().min(1),
	url: z.string().min(1),
});

export const currentVersionSchema = z.object({
	pkgver: z.string().min(1),
	upstreamPkgver: z.string().min(1),
	commit: z.string().min(1),
});

export const latestVersionSchema = z.object({
	upstreamPkgver: z.string().min(1),
	pkgver: z.string().min(1),
	commit: z.string().min(1),
	downloadUrl: z.string().min(1),
});

export const checkResultSchema = z.object({
	channel: channelKeySchema,
	current_pkgver: z.string().min(1),
	current_upstream_pkgver: z.string().min(1),
	current_commit: z.string().min(1),
	latest_pkgver: z.string().min(1),
	latest_upstream_pkgver: z.string().min(1),
	latest_commit: z.string().min(1),
	update_available: z.boolean(),
});

export type ChannelKey = z.infer<typeof channelKeySchema>;
export type CurrentVersion = z.infer<typeof currentVersionSchema>;
export type LatestVersion = z.infer<typeof latestVersionSchema>;
