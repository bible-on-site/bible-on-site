import { sefarim } from "./db/sefarim";
import {
	type Additionals,
	Pasuk,
	type Perek,
	type SefarimItem,
} from "./db/tanah-view-types";
export type SeferObj = Additionals | SefarimItem;
export function getSeferByName(
	seferName: string,
	additionalLetter?: string,
): SeferObj {
	let sefer: Additionals | SefarimItem = sefarim.find(
		(sefer) => sefer.name === seferName,
	)!;
	if (!sefer) {
		throw new Error(`Invalid seferName: ${seferName}`);
	}
	if (additionalLetter) {
		sefer = sefer.additionals.find(
			(additional) => additional.letter === additionalLetter,
		)!;
	}
	return sefer;
}

export function getAllPerakim(): (Perek & { perekId: number })[] {
	let perekIdCounter = 1;
	return sefarim.flatMap((sefer) => {
		const perakim = sefer.perakim || [
			...(sefer.additionals?.[0]?.perakim || []),
			...(sefer.additionals?.[1]?.perakim || []),
		];
		return perakim.map((perek) => ({ ...perek, perekId: perekIdCounter++ }));
	});
}
