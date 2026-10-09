import type { SefarimItem } from "@/data/db/tanah-view-types";
import type { PerekObj } from "@/data/perek-dto";

export function seferFixture(perek: PerekObj): SefarimItem {
	return {
		name: perek.sefer,
		helek: perek.helek,
		tanachUsName: "Fixture",
		perekFrom: perek.perekId,
		perekTo: perek.perekId,
		pesukimCount: perek.pesukim.length,
		perakim: [
			{
				header: perek.header,
				pesukim: perek.pesukim,
				recitation: perek.recitation,
				date: [],
				star_rise: [],
			},
		],
	};
}
