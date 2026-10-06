import { toLetters } from "gematry";
import { sefarim } from "./db/sefarim";
import type {
	Additionals,
	AdditionalsItem,
	Pasuk,
	RecitationRecording,
	SefarimItemWithPerakim,
} from "./db/tanah-view-types";

export { getPerekIdByDate, getTodaysPerekId } from "./perek-calendar";
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
