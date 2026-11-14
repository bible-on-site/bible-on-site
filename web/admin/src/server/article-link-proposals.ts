/**
 * Server-function surface for the article-linking pipeline (#3103).
 * This module intentionally exports ONLY createServerFn wrappers (plus
 * type-only exports) so the client bundle receives RPC stubs and never
 * pulls in the server-only pipeline imports — all implementation lives in
 * ./article-link-pipeline.
 */
import { createServerFn } from "@tanstack/react-start";
import type {
	ArticleGenerationOutcome,
	LinkProposal,
	LinkProposalStatus,
} from "~/lib/article-linking/types";
import type {
	ApplyOutcome,
	GenerateLinkProposalsInput,
	LinkPipelineStatus,
	LinkProposalDetail,
	LinkRunSummary,
	ListProposalsFilter,
	ReviewInput,
} from "./article-link-pipeline";
import {
	applyProposals,
	getProposalDetail,
	listProposals,
	listRuns,
	pipelineStatus,
	reviewProposal,
	runLinkGeneration,
	validateGenerateInput,
} from "./article-link-pipeline";
import { resolveEditorIdentity } from "./editor-identity";

export type {
	ApplyOutcome,
	GenerateLinkProposalsInput,
	LinkPipelineStatus,
	LinkProposalDetail,
	LinkRunSummary,
	ReviewInput,
};

/**
 * Draft generation for a bounded article set. Generation ONLY writes
 * proposal/checkpoint rows — relationship tables stay untouched.
 */
export const generateLinkProposals = createServerFn({ method: "POST" })
	.validator(validateGenerateInput)
	.handler(
		async ({
			data,
		}): Promise<{ runId: string; outcomes: ArticleGenerationOutcome[] }> =>
			runLinkGeneration(data),
	);

export const listLinkProposals = createServerFn({ method: "GET" })
	.validator((data?: ListProposalsFilter) => data ?? {})
	.handler(async ({ data }): Promise<LinkProposal[]> => listProposals(data));

export const getLinkProposal = createServerFn({ method: "GET" })
	.validator((id: string) => id)
	.handler(
		async ({ data: id }): Promise<LinkProposalDetail | null> =>
			getProposalDetail(id),
	);

export const listLinkRuns = createServerFn({ method: "GET" }).handler(
	async (): Promise<LinkRunSummary[]> => listRuns(),
);

/**
 * The human gate — generation never approves its own output; every
 * decision records the authenticated editor identity.
 */
export const reviewLinkProposal = createServerFn({ method: "POST" })
	.validator((data: ReviewInput) => data)
	.handler(
		async ({ data }): Promise<{ id: string; status: LinkProposalStatus }> => {
			const reviewer = (await resolveEditorIdentity()).id;
			return reviewProposal(data, reviewer);
		},
	);

export const applyLinkProposals = createServerFn({ method: "POST" })
	.validator((data: { ids: string[] }) => {
		if (!Array.isArray(data.ids) || data.ids.length === 0) {
			throw new Error("יש לבחור הצעות להחלה");
		}
		return data;
	})
	.handler(async ({ data }): Promise<{ outcomes: ApplyOutcome[] }> => {
		const reviewer = (await resolveEditorIdentity()).id;
		return applyProposals(data.ids, reviewer);
	});

/** Pipeline capability surface for the admin panel. */
export const getLinkPipelineStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<LinkPipelineStatus> => pipelineStatus(),
);
