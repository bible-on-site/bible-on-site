import { sefarim } from "./db/sefarim";
import type {
	AdditionalsItem,
	Perek,
	SefarimItem,
	SefarimItemWithPerakim,
} from "./db/tanah-view-types";
export type Sefer = SefarimItemWithPerakim;
export type Additional = AdditionalsItem;

export function getSeferOrAdditionalByName(
	seferName: string,
	additionalLetter?: string,
): Sefer | Additional {
	const seferBeforeAdditionalExtraction: SefarimItem | undefined = sefarim.find(
		(sefer) => sefer.name === seferName,
	);
	if (!seferBeforeAdditionalExtraction) {
		throw new Error(`Invalid sefer name: ${seferName}`);
	}

	if (additionalLetter) {
		if (!("additionals" in seferBeforeAdditionalExtraction)) {
			throw new Error(
				`Sefer ${seferName} has no addtionals at all and requested additional letter: ${additionalLetter}`,
			);
		}
		const additional = seferBeforeAdditionalExtraction.additionals.find(
			(additional) => additional.letter === additionalLetter,
		);
		if (!additional) {
			throw new Error(`Invalid additional letter: ${additionalLetter}`);
		}
		return additional;
	}

	const nonAdditionalSefer =
		seferBeforeAdditionalExtraction as SefarimItemWithPerakim;
	return nonAdditionalSefer;
}

export function getSeferByName(seferName: string): SefarimItem {
	const sefer = sefarim.find((sefer) => sefer.name === seferName);
	if (!sefer) {
		throw new Error(`Invalid sefer name: ${seferName}`);
	}
	return sefer;
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
