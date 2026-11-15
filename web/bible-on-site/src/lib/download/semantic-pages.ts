import { toNumber } from "gematry";
import { getPerekIdsForSefer, getSeferByName } from "@/data/sefer-dto";
import { ExportError } from "./export-error";
import type { SemanticPageInfo } from "./types";

/** Export errors are safe to surface to the reader. */
export const REVERSED_RANGE_MESSAGE =
	"טווח לא תקין: פרק ההתחלה מאוחר מפרק הסיום.";

/**
 * Map semantic chapter names to canonical ids in reading order. Keep this
 * selection logic independent of PDF renderers and their font codecs so the
 * bulletin-backed download handlers can register without loading them.
 */
export function semanticPagesToPerekIds(
	semanticPages: SemanticPageInfo[],
	seferName: string,
): number[] {
	const sefer = getSeferByName(seferName);
	const allPerekIds = getPerekIdsForSefer(sefer);

	const perekIds: number[] = [];
	const seen = new Set<number>();
	let lastPerekNum = 0;

	for (const sp of semanticPages) {
		const perekNum = toNumber(sp.semanticName);
		if (perekNum <= 0 || perekNum > allPerekIds.length) continue;
		if (perekNum < lastPerekNum) {
			throw new ExportError(REVERSED_RANGE_MESSAGE);
		}
		lastPerekNum = perekNum;
		const perekId = allPerekIds[perekNum - 1];
		if (perekId !== undefined && !seen.has(perekId)) {
			seen.add(perekId);
			perekIds.push(perekId);
		}
	}

	return perekIds;
}
