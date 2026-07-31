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

const versionSummarySchema = z.object({
	pkgver: z.string().min(1),
	upstream_pkgver: z.string().min(1),
	commit: z.string().min(1),
});

export const publicationDecisionSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("update-available"),
		latest: versionSummarySchema,
	}),
	z.object({
		status: z.literal("up-to-date"),
	}),
	z.object({
		status: z.literal("release-unavailable"),
		message: z.string().min(1),
	}),
	z.object({
		status: z.literal("architecture-mismatch"),
		message: z.string().min(1),
	}),
	z.object({
		status: z.literal("artifact-unavailable"),
		message: z.string().min(1),
	}),
]);

export const checkResultSchema = z.object({
	channel: channelKeySchema,
	current: versionSummarySchema,
	publication: publicationDecisionSchema,
});

export type ChannelKey = z.infer<typeof channelKeySchema>;
export type CurrentVersion = z.infer<typeof currentVersionSchema>;
export type LatestVersion = z.infer<typeof latestVersionSchema>;
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;
