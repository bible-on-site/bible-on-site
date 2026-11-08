import { toLetters } from "gematry";
import { sefarim } from "./db/sefarim";
import type {
	Additionals,
	AdditionalsItem,
	Pasuk,
	RecitationRecording,
	Sefarim,
	SefarimItemWithPerakim,
} from "./db/tanah-view-types";

export { getPerekIdByDate, getTodaysPerekId } from "./perek-calendar";

/** Last canonical perek id — the sequence is a closed 1-929 list. */
export const LAST_PEREK_ID = 929;

/**
 * Distinct canonical perakim with a published recording: a perek carries a
 * `recitation` record only once its audio asset is actually published, so
 * counting `recitation.audioUrl` counts each recorded perek exactly once.
 * Alignment approval is unrelated to availability — a playable recording
 * counts even while its word timings await review (#2397).
 */
export function countRecordedPerakim(data: Sefarim = sefarim): number {
	let count = 0;
	for (const sefer of data) {
		const groups: { perakim: { recitation?: RecitationRecording }[] }[] =
			"additionals" in sefer ? sefer.additionals : [sefer];
		for (const group of groups) {
			for (const perek of group.perakim) {
				if (perek.recitation?.audioUrl) count += 1;
			}
		}
	}
	return count;
}
/**
 * Previous/next perakim in the canonical 1-929 id sequence, resolved to
 * full objects with the canonical source formatter (including
 * additional-book labels like עזרא ע י / עזרא נ א). The corpus edges
 * return null so callers never fabricate /929/0 or /929/930 (#2518).
 */
export function getAdjacentPereks(
	perekId: number,
): { prev: PerekObj | null; next: PerekObj | null } {
	return {
		prev: perekId > 1 ? getPerekByPerekId(perekId - 1) : null,
		next: perekId < LAST_PEREK_ID ? getPerekByPerekId(perekId + 1) : null,
	};
}

export interface PerekObj {
	recitation?: RecitationRecording;
	perekId: number;
	perekHeb: string;
	header: string;
	pesukim: Pasuk[];
	helek: string;
	sefer: string;
	source: string;
	additional?: string;
}

export function getPerekByPerekId(perekId: number): PerekObj {
	if (perekId < 1 || perekId > 929) {
		throw new Error(`Invalid perekId: ${perekId}`);
	}
	const sefer = sefarim.find(
		(sefer) => sefer.perekFrom <= perekId && sefer.perekTo >= perekId,
	);

	/* istanbul ignore next: should never happen */
	if (!sefer) {
		throw new Error(`No sefer found for perekId: ${perekId}`);
	}

	const seferOrAdditional: SefarimItemWithPerakim | Additionals | undefined =
		"additionals" in sefer
			? sefer.additionals.find(
					(a) => a.perekFrom <= perekId && a.perekTo >= perekId,
				)
			: sefer;
	/* istanbul ignore next: should never happen */
	if (!seferOrAdditional) {
		throw new Error(
			`Addtionals perakim range is different from their sefer (${sefer.name}) perakim range`,
		);
	}
	const perekNum = perekId - seferOrAdditional.perekFrom + 1;
	const perekIdx = perekNum - 1;
	const perek = seferOrAdditional.perakim.at(perekIdx);
	/* istanbul ignore next: should never happen */
	if (!perek) {
		throw new Error(`No perek found for perekId: ${perekId}`);
	}
	const perekHeb = toLetters(perekNum);
	const additional =
		"additionals" in sefer ? (seferOrAdditional as AdditionalsItem) : undefined;
	return {
		perekId,
		perekHeb,
		header: perek.header,
		recitation: perek.recitation,
		pesukim: perek.pesukim,
		helek: seferOrAdditional.helek,
		sefer: sefer.name,
		additional: additional ? additional.letter : undefined,
		source: `${sefer.name}${
			additional ? ` ${additional.letter} ` : " "
		}${perekHeb}`,
	};
}
