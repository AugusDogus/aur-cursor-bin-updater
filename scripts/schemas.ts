import { z } from "zod";

import {
	channelKeySchema,
	channelTargetSchema,
	type ChannelKey,
} from "./lib/channels";

export { channelKeySchema };

const upstreamVersionSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._+-]*$/,
		"Version must contain only shell-safe release characters",
	);
const pkgverSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._+]*$/,
		"pkgver must contain only Arch-safe version characters",
	);
const commitSchema = z
	.string()
	.regex(/^[0-9a-f]{40}$/, "Commit must be a 40-character lowercase Git hash");
const cursorDownloadUrlSchema = z.string().url().refine(
	(value) => {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "downloads.cursor.com";
	},
	"Download URL must use HTTPS on downloads.cursor.com",
);

export const updateApiResponseSchema = z.looseObject({
	version: upstreamVersionSchema,
	url: cursorDownloadUrlSchema,
});

export const currentVersionSchema = z.object({
	pkgver: pkgverSchema,
	upstreamPkgver: upstreamVersionSchema,
	commit: commitSchema,
});

export const latestVersionSchema = z.object({
	upstreamPkgver: upstreamVersionSchema,
	pkgver: pkgverSchema,
	commit: commitSchema,
	downloadUrl: cursorDownloadUrlSchema,
});

const versionSummarySchema = z.object({
	pkgver: pkgverSchema,
	upstream_pkgver: upstreamVersionSchema,
	commit: commitSchema,
});

const updateAvailableDecisionSchema = z.object({
	status: z.literal("update-available"),
	latest: versionSummarySchema,
});
const upToDateDecisionSchema = z.object({
	status: z.literal("up-to-date"),
});
const releaseUnavailableDecisionSchema = z.object({
	status: z.literal("release-unavailable"),
	message: z.string().min(1),
});
const architectureMismatchDecisionSchema = z.object({
	status: z.literal("architecture-mismatch"),
	message: z.string().min(1),
});
const artifactUnavailableDecisionSchema = z.object({
	status: z.literal("artifact-unavailable"),
	message: z.string().min(1),
});
const nonUpdatePublicationDecisionSchema = z.discriminatedUnion("status", [
	upToDateDecisionSchema,
	releaseUnavailableDecisionSchema,
	architectureMismatchDecisionSchema,
	artifactUnavailableDecisionSchema,
]);
export const publicationDecisionSchema = z.discriminatedUnion("status", [
	updateAvailableDecisionSchema,
	upToDateDecisionSchema,
	releaseUnavailableDecisionSchema,
	architectureMismatchDecisionSchema,
	artifactUnavailableDecisionSchema,
]);

export const checkResultSchema = z.object({
	channel: channelKeySchema,
	current: versionSummarySchema,
	publication: publicationDecisionSchema,
});

export const preparationPlanSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("skip"),
		publication: nonUpdatePublicationDecisionSchema,
	}),
	z.object({
		status: z.literal("publish-current"),
		package: versionSummarySchema,
	}),
	z.object({
		status: z.literal("update-and-publish"),
		package: versionSummarySchema,
	}),
]);
export const preparationResultSchema = z.object({
	target: channelTargetSchema,
	plan: preparationPlanSchema,
});

export type { ChannelKey };
export type CurrentVersion = z.infer<typeof currentVersionSchema>;
export type LatestVersion = z.infer<typeof latestVersionSchema>;
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;
export type PreparationPlanDto = z.infer<typeof preparationPlanSchema>;
export type PreparationResult = z.infer<typeof preparationResultSchema>;
