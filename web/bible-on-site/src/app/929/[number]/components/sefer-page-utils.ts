import { toLetters, toNumber } from "gematry";
import type { HistoryMapper, PageSemantics } from "html-flip-book-react";

const CONTENT_OFFSET = 3;

export function toHebrewWithPunctuation(num: number): string {
	const letters = toLetters(num, { addQuotes: true });
	if (!letters.includes('"') && letters.length === 1) {
		return `${letters}'`;
	}
	return letters;
}

export function buildPageSemantics(
	perakimLength: number,
	perekHeaders: Array<string | undefined>,
): PageSemantics {
	return {
		indexToSemanticName(pageIndex: number): string {
			if (pageIndex < CONTENT_OFFSET) return "";
			const adjusted = pageIndex - CONTENT_OFFSET;
			if (adjusted % 2 !== 0) return "";
			const perekNum = adjusted / 2 + 1;
			if (perekNum > perakimLength) return "";
			return toHebrewWithPunctuation(perekNum);
		},
		semanticNameToIndex(semanticPageName: string): number | null {
			const num = toNumber(semanticPageName);
			if (num === 0) return null;
			if (num > perakimLength) return null;
			return (num - 1) * 2 + CONTENT_OFFSET;
		},
		indexToTitle(pageIndex: number): string {
			if (pageIndex < CONTENT_OFFSET) return "";
			const adjusted = pageIndex - CONTENT_OFFSET;
			if (adjusted % 2 !== 0) return "";
			const perekIdx = adjusted / 2;
			if (perekIdx >= perakimLength) return "";
			return (
				perekHeaders[perekIdx] ||
				`פרק ${toHebrewWithPunctuation(perekIdx + 1)}`
			);
		},
	};
}

export function buildHistoryMapper(
	perekIds: number[] | undefined,
	pageSemantics: PageSemantics,
): HistoryMapper {
	return {
		pageToRoute: (pageIndex, _semantic) => {
			if (pageIndex < CONTENT_OFFSET) return null;
			const perekIdx = Math.floor((pageIndex - CONTENT_OFFSET) / 2);
			const clampedIdx = Math.min(
				perekIdx,
				(perekIds?.length ?? 1) - 1,
			);
			const id = perekIds?.[clampedIdx];
			if (id == null) return null;
			return `/929/${id}?book`;
		},
		routeToPage: (route) => {
			if (route.includes("?book")) {
				const m = route.match(/\/929\/(\d+)/);
				if (m) {
					const id = Number.parseInt(m[1], 10);
					const idx = perekIds?.indexOf(id) ?? -1;
					if (idx >= 0) return idx * 2 + CONTENT_OFFSET;
				}
			}
			const hashMatch = route.match(/#page\/(.+)/);
			if (hashMatch) {
				return pageSemantics.semanticNameToIndex(hashMatch[1]);
			}
			return null;
		},
	};
}

export function computeInitialTurnedLeaves(
	perekIds: number[] | undefined,
	currentPerekId: number,
): number[] | undefined {
	const idx = perekIds?.indexOf(currentPerekId) ?? -1;
	if (idx < 0) return undefined;
	const pageIndex = idx * 2 + CONTENT_OFFSET;
	const turnedCount = Math.ceil(pageIndex / 2);
	return Array.from({ length: turnedCount }, (_, i) => i);
}

export function wrapDownloadResult(
	r: { ext: string; data: string } | { error: string },
): { ext: string; data: string } | null {
	return "error" in r ? null : { ext: r.ext, data: r.data };
}

export { CONTENT_OFFSET };
