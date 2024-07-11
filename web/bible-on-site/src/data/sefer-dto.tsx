import { sefarim } from "./db/sefarim";
import type {
	Additionals,
	Perek,
	SefarimItem,
	SefarimItemWithAdditionals,
	SefarimItemWithPerakim,
} from "./db/tanah-view-types";
export type SeferObj = Additionals | SefarimItemWithPerakim;
export function getSeferByName(
	seferName: string,
	additionalLetter?: string,
): SeferObj {
	const seferBeforeAdditionalExtraction: SefarimItem | undefined = sefarim.find(
		(sefer) => sefer.name === seferName,
	);
	if (!seferBeforeAdditionalExtraction) {
		throw new Error(`Invalid seferName: ${seferName}`);
	}
	if (additionalLetter) {
		const additional = (
			seferBeforeAdditionalExtraction as SefarimItemWithAdditionals
		).additionals.find((additional) => additional.letter === additionalLetter);
		if (!additional) {
			throw new Error(`Invalid additionalLetter: ${additionalLetter}`);
		}
		return additional;
	}
	const nonAdditionalSefer =
		seferBeforeAdditionalExtraction as SefarimItemWithPerakim;
	return nonAdditionalSefer;
}

export function getAllPerakim(): (Perek & { perekId: number })[] {
	let perekIdCounter = 1;
	return sefarim.flatMap((sefer) => {
		const perakim =
			"perakim" in sefer
				? sefer.perakim
				: [...sefer.additionals[0].perakim, ...sefer.additionals[1].perakim];
		return perakim.map((perek) => ({ ...perek, perekId: perekIdCounter++ }));
	});
}
