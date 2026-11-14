/**
 * Server-side validation of model output (#3103). Raw LLM/heuristic
 * candidates become `DraftProposal`s — `pending` (valid, reviewable) or
 * `held` (invalid/ambiguous/unresolvable — surfaced, never repaired by
 * inventing facts). Nothing here mutates live data.
 */
import { relationshipFor } from "~/lib/article-relationships";
import {
	cataloguePasukLabel,
	cataloguePerekLabel,
	type PerekRef,
	pasukWithinBounds,
	resolvePerekRef,
	type TargetCatalogue,
} from "./catalogue";
import { parseHebrewNumber } from "./hebrew-numerals";
import { locateQuote } from "./html-text";
import type {
	ArticleLinkSnapshot,
	DraftProposal,
	LinkProposalAction,
	PasukCoordinate,
	ProposalEvidence,
} from "./types";

export const AUTHOR_ATTRIBUTION_POLICY_REASON =
	"author attribution is fixed on upload/import; link proposals cannot change it";

/** The raw model JSON shape — every field optional/unchecked until validated. */
export interface RawModelOutput {
	proposals?: Array<{
		relationshipKey?: string;
		action?: string;
		target?: Record<string, unknown>;
		evidence?: Array<{ quote?: string }>;
		rationale?: string;
		confidence?: number;
	}>;
	abstentions?: Array<{ relationshipKey?: string; reason?: string }>;
}

export interface ValidatedModelOutput {
	drafts: DraftProposal[];
	/** Count of raw items that could not even be held (malformed). */
	malformed: number;
	abstentions: { relationshipKey: string; reason: string }[];
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

/** A number OR Hebrew numeral string → int. The model may write either. */
function numeral(value: unknown): number | null {
	if (isInt(value)) return value;
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
		return parseHebrewNumber(trimmed);
	}
	return null;
}

function clampConfidence(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.min(1, Math.max(0, value));
}

/** Anchors each supplied evidence quote in the article's plain-text view. */
function anchorEvidence(
	raw: Array<{ quote?: string }> | undefined,
	plainText: string,
): { evidence: ProposalEvidence[]; unanchored: string[] } {
	const evidence: ProposalEvidence[] = [];
	const unanchored: string[] = [];
	for (const item of raw ?? []) {
		const quote = typeof item.quote === "string" ? item.quote : "";
		const located = quote ? locateQuote(plainText, quote) : null;
		if (located) {
			evidence.push({ quote, ...located });
		} else if (quote) {
			unanchored.push(quote);
		}
	}
	return { evidence, unanchored };
}

function makeHeld(
	relationshipKey: string,
	action: LinkProposalAction,
	target: unknown,
	conflict: string,
	evidence: ProposalEvidence[],
	rationale: string | null,
	confidence: number | null,
): DraftProposal {
	return {
		relationshipKey,
		action,
		target: target as DraftProposal["target"],
		targetLabel: "(לא נפתר)",
		evidence,
		rationale,
		confidence,
		conflict,
		status: "held",
	};
}

/** Validates a citation-like target token into a canonical coordinate. */
function resolveCitationTarget(
	raw: Record<string, unknown>,
	catalogue: TargetCatalogue,
):
	| { coordinate: PasukCoordinate; label: string; error?: undefined }
	| { error: string; coordinate?: undefined; label?: undefined } {
	const sefer = typeof raw.sefer === "string" ? raw.sefer.trim() : "";
	if (!sefer) return { error: "missing sefer" };
	const additional =
		typeof raw.additional === "string" && raw.additional.trim()
			? raw.additional.trim().replace(/["'׳״]/g, "")
			: null;
	const perek = numeral(raw.perek);
	const pasuk = numeral(raw.pasuk);
	if (perek === null || pasuk === null) {
		return { error: "unparseable perek/pasuk" };
	}
	const ref: PerekRef = { sefer, additional, perek, pasuk };
	const resolution = resolvePerekRef(catalogue, ref);
	if (resolution.kind === "not-found") {
		return { error: `no such perek: ${sefer} ${perek}` };
	}
	if (resolution.kind === "ambiguous") {
		return { error: `ambiguous perek: ${sefer} ${perek}` };
	}
	if (!pasukWithinBounds(resolution.perek, pasuk)) {
		return {
			error: `pasuk ${pasuk} out of range for ${cataloguePerekLabel(resolution.perek)}`,
		};
	}
	return {
		coordinate: { perekId: resolution.perek.id, pasuk },
		label: cataloguePasukLabel(resolution.perek, pasuk),
	};
}

/** A perek-only target (primaryPerek replace) → canonical perek id. */
function resolvePerekTarget(
	raw: Record<string, unknown>,
	catalogue: TargetCatalogue,
):
	| { perekId: number; label: string; error?: undefined }
	| { error: string; perekId?: undefined; label?: undefined } {
	// Direct id form is accepted but only when it exists in the catalogue.
	if (isInt(raw.perekId)) {
		const found = catalogue.perakim.find((p) => p.id === raw.perekId);
		if (!found) return { error: `perek ${raw.perekId} does not exist` };
		return { perekId: found.id, label: cataloguePerekLabel(found) };
	}
	const sefer = typeof raw.sefer === "string" ? raw.sefer.trim() : "";
	const perek = numeral(raw.perek);
	if (!sefer || perek === null) return { error: "missing sefer/perek" };
	const additional =
		typeof raw.additional === "string" && raw.additional.trim()
			? raw.additional.trim().replace(/["'׳״]/g, "")
			: null;
	const resolution = resolvePerekRef(catalogue, {
		sefer,
		additional,
		perek,
		pasuk: null,
	});
	if (resolution.kind !== "resolved") {
		return { error: `${resolution.kind} perek: ${sefer} ${perek}` };
	}
	return {
		perekId: resolution.perek.id,
		label: cataloguePerekLabel(resolution.perek),
	};
}

export interface NormalizedTarget {
	target?: DraftProposal["target"];
	label?: string;
	heldReason?: string;
}

/**
 * Normalizes a raw target payload (model output OR a human review patch —
 * the same shape) against the live catalogue. Exported for the review
 * endpoint: an edited patch is validated identically before it can be
 * approved — a forged id or out-of-range pasuk can never reach apply.
 */
export function normalizeTarget(
	relationshipKey: string,
	raw: Record<string, unknown>,
	catalogue: TargetCatalogue,
	snapshot: ArticleLinkSnapshot,
): NormalizedTarget {
	switch (relationshipKey) {
		case "primaryPerek": {
			const resolved = resolvePerekTarget(raw, catalogue);
			if (resolved.error !== undefined) {
				return { heldReason: resolved.error };
			}
			if (resolved.perekId === snapshot.perekId) {
				return { heldReason: "already the current primary perek" };
			}
			return {
				target: { perekId: resolved.perekId },
				label: resolved.label,
			};
		}
		case "author":
			return { heldReason: AUTHOR_ATTRIBUTION_POLICY_REASON };
		case "coveringSources": {
			const rawCitations = Array.isArray(raw.citations)
				? raw.citations
				: Array.isArray(raw.pasukCoordinates)
					? raw.pasukCoordinates
					: [];
			if (rawCitations.length === 0) {
				return { heldReason: "no citations supplied" };
			}
			const coordinates: PasukCoordinate[] = [];
			const labels: string[] = [];
			const seen = new Set<string>();
			for (const item of rawCitations) {
				// Direct coordinate form is also validated against the catalogue.
				if (isInt((item as { perekId?: unknown }).perekId)) {
					const perekId = (item as { perekId: number }).perekId;
					const pasuk = numeral((item as { pasuk?: unknown }).pasuk);
					const perek = catalogue.perakim.find((p) => p.id === perekId);
					if (!perek) return { heldReason: `perek ${perekId} does not exist` };
					if (pasuk === null || !pasukWithinBounds(perek, pasuk)) {
						return {
							heldReason: `pasuk ${String(pasuk)} out of range for ${cataloguePerekLabel(perek)}`,
						};
					}
					const key = `${perekId}:${pasuk}`;
					if (!seen.has(key)) {
						seen.add(key);
						coordinates.push({ perekId, pasuk });
						labels.push(cataloguePasukLabel(perek, pasuk));
					}
					continue;
				}
				const resolved = resolveCitationTarget(
					item as Record<string, unknown>,
					catalogue,
				);
				if (resolved.error !== undefined) {
					return { heldReason: resolved.error };
				}
				const key = `${resolved.coordinate.perekId}:${resolved.coordinate.pasuk}`;
				if (!seen.has(key)) {
					seen.add(key);
					coordinates.push(resolved.coordinate);
					labels.push(resolved.label);
				}
			}
			const coverageVerified =
				typeof raw.coverageVerified === "boolean"
					? raw.coverageVerified
					: undefined;
			return {
				target: { pasukCoordinates: coordinates, coverageVerified },
				label: labels.join(", "),
			};
		}
		case "dedicationAssignments": {
			const dedicationId = numeral(raw.dedicationId ?? raw.id);
			const dedication = catalogue.dedications.find(
				(d) => d.id === dedicationId,
			);
			if (!dedication) {
				return {
					heldReason: `dedication ${String(raw.dedicationId)} not in catalogue`,
				};
			}
			const expiresAt =
				typeof raw.expiresAt === "string" && raw.expiresAt.trim()
					? raw.expiresAt.trim()
					: null;
			return {
				target: { dedicationId: dedication.id, expiresAt },
				label: dedication.subject,
			};
		}
		case "recurringHebrewDate": {
			const month = typeof raw.month === "string" ? raw.month.trim() : "";
			const day = numeral(raw.day);
			if (!month || day === null) {
				return { heldReason: "recurringHebrewDate needs month+day" };
			}
			return {
				target: { month, day },
				label: `${day} ${month}`,
				heldReason:
					"pending-schema (#3098): stored for review — never applied until the contract lands",
			};
		}
		case "moadim": {
			const moedName =
				typeof raw.moedName === "string" && raw.moedName.trim()
					? raw.moedName.trim()
					: typeof raw.name === "string"
						? raw.name.trim()
						: "";
			if (!moedName) return { heldReason: "moadim needs a moed name" };
			return {
				target: { moedName },
				label: moedName,
				heldReason:
					"pending-schema (#3101): stored for review — never applied until the contract lands",
			};
		}
		default:
			return { heldReason: `unsupported relationship key: ${relationshipKey}` };
	}
}

const VALID_ACTIONS = new Set(["add", "remove", "replace", "clear"]);

/**
 * Whether a proposal-level action is expressible through the entry's write
 * contract. `add`/`remove` on a many-cardinality key whose ops include
 * `replace` are set-merge intents — the apply planner merges them into the
 * contract's whole-set replace write.
 */
function proposalActionAllowed(
	entry: { cardinality: string; operations: string[] },
	action: LinkProposalAction,
): boolean {
	if (entry.operations.includes(action)) return true;
	if (
		entry.cardinality === "many" &&
		(action === "add" || action === "remove") &&
		entry.operations.includes("replace")
	) {
		return true;
	}
	return false;
}

/**
 * Validates raw model output into pending/held drafts. `heldReason` on a
 * normalized target means the draft is held with that conflict — the
 * reviewer sees every attempt, including hallucinated targets.
 */
export function validateModelOutput(
	raw: RawModelOutput,
	options: {
		catalogue: TargetCatalogue;
		plainText: string;
		snapshot: ArticleLinkSnapshot;
	},
): ValidatedModelOutput {
	const drafts: DraftProposal[] = [];
	const abstentions: ValidatedModelOutput["abstentions"] = [];
	let malformed = 0;

	for (const item of raw.abstentions ?? []) {
		if (item.relationshipKey) {
			abstentions.push({
				relationshipKey: String(item.relationshipKey),
				reason: typeof item.reason === "string" ? item.reason : "",
			});
		}
	}

	for (const item of raw.proposals ?? []) {
		const relationshipKey =
			typeof item.relationshipKey === "string" ? item.relationshipKey : "";
		const action = (
			typeof item.action === "string" ? item.action : ""
		) as LinkProposalAction;
		const rationale =
			typeof item.rationale === "string" && item.rationale.trim()
				? item.rationale.trim()
				: null;
		const confidence = clampConfidence(item.confidence);
		const { evidence, unanchored } = anchorEvidence(
			item.evidence,
			options.plainText,
		);
		const target = (item.target ?? {}) as Record<string, unknown>;

		if (!relationshipKey || !VALID_ACTIONS.has(action)) {
			malformed += 1;
			continue;
		}
		if (relationshipKey === "author") {
			// Attribution is supplied by the uploader, never inferred or offered
			// as a reviewable draft, even when the model provides valid evidence.
			abstentions.push({
				relationshipKey,
				reason: AUTHOR_ATTRIBUTION_POLICY_REASON,
			});
			continue;
		}
		const entry = relationshipFor(relationshipKey);
		if (!entry) {
			drafts.push(
				makeHeld(
					relationshipKey,
					action,
					target,
					`unsupported relationship key: ${relationshipKey}`,
					evidence,
					rationale,
					confidence,
				),
			);
			continue;
		}
		if (entry.status === "pending-schema") {
			// Still validated+stored (surfaced as held), never applicable.
			const normalized = normalizeTarget(
				relationshipKey,
				target,
				options.catalogue,
				options.snapshot,
			);
			/* istanbul ignore next -- pending-schema normalizers always report heldReason */
			const pendingReason =
				normalized.heldReason ??
				`pending-schema (#${entry.pendingIssue}): never applied until the contract lands`;
			drafts.push(
				makeHeld(
					relationshipKey,
					action,
					normalized.target ?? target,
					pendingReason,
					evidence,
					rationale,
					confidence,
				),
			);
			continue;
		}
		if (!proposalActionAllowed(entry, action)) {
			/* istanbul ignore next -- every registry entry declares at least one operation */
			const opsLabel = entry.operations.join("/") || "none";
			drafts.push(
				makeHeld(
					relationshipKey,
					action,
					target,
					`action "${action}" is not expressible for ${relationshipKey} (ops: ${opsLabel})`,
					evidence,
					rationale,
					confidence,
				),
			);
			continue;
		}

		const normalized = normalizeTarget(
			relationshipKey,
			target,
			options.catalogue,
			options.snapshot,
		);
		if (normalized.heldReason || !normalized.target) {
			/* istanbul ignore next -- normalizeTarget failure paths always set heldReason */
			const heldReason = normalized.heldReason ?? "unresolved target";
			drafts.push(
				makeHeld(
					relationshipKey,
					action,
					normalized.target ?? target,
					heldReason,
					evidence,
					rationale,
					confidence,
				),
			);
			continue;
		}
		if (evidence.length === 0) {
			// Missing, unusable and hallucinated quotes all fail the evidence
			// requirement; none can become a pending proposal for approval.
			const evidenceReason = unanchored.length
				? `evidence not anchored in article text: ${unanchored.slice(0, 2).join(" | ")}`
				: "proposal carries no anchored evidence from article text";
			drafts.push(
				makeHeld(
					relationshipKey,
					action,
					normalized.target,
					evidenceReason,
					evidence,
					rationale,
					confidence,
				),
			);
			continue;
		}
		const conflict = unanchored.length
			? `some evidence not anchored: ${unanchored.slice(0, 2).join(" | ")}`
			: null;
		/* istanbul ignore next -- successful normalizations always carry a label */
		const targetLabel = normalized.label ?? relationshipKey;
		drafts.push({
			relationshipKey,
			action,
			target: normalized.target,
			targetLabel,
			evidence,
			rationale,
			confidence,
			conflict,
			status: "pending",
		});
	}
	return { drafts, malformed, abstentions };
}
