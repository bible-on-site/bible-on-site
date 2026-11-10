import type { Pasuk } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	pasukLine,
	pasukText,
	scriptureMarkdown,
} from "@/lib/markdown/scripture";

function qri(value: string): Pasuk["segments"][number] {
	return {
		type: "qri",
		value,
		recordingTimeFrame: { from: "00:00:00", to: "00:00:01" },
	};
}

describe("pasukText", () => {
	it("joins qri segments with spaces", () => {
		const pasuk: Pasuk = { segments: [qri("אֱלֹהִים"), qri("בָּרָא")] };
		expect(pasukText(pasuk)).toBe("אֱלֹהִים בָּרָא");
	});

	it("prints stuma and ptuha markers in segment position", () => {
		const pasuk: Pasuk = {
			segments: [qri("דָּבָר"), { type: "stuma" }, qri("אַחֵר"), { type: "ptuha" }],
		};
		expect(pasukText(pasuk)).toBe("דָּבָר (ס) אַחֵר (פ)");
	});

	it("prints qri over paired ktiv, and marks orphan ktiv", () => {
		const paired: Pasuk = {
			segments: [
				{ type: "ktiv", value: "יְרוּשָׁלִַם", qriOffset: 1 },
				qri("יְרוּשָׁלַיִם"),
			],
		};
		expect(pasukText(paired)).toBe("יְרוּשָׁלַיִם");

		const orphan: Pasuk = {
			segments: [
				{ type: "ktiv", value: "כתיב-בלבד", qriOffset: 0 },
				qri("אַחַר"),
			],
		};
		expect(pasukText(orphan)).toBe("[כתיב: כתיב-בלבד] אַחַר");
	});

	it("skips empty segments without leaving doubled spaces", () => {
		const pasuk: Pasuk = { segments: [qri(""), qri("מילה"), qri("")] };
		expect(pasukText(pasuk)).toBe("מילה");
	});

	it("clips mid-pasuk segment bounds before rendering", () => {
		const pasuk: Pasuk = {
			segments: [qri("אַחַד"), { type: "ptuha" }, qri("שְׁנַיִם"), qri("שָׁלִישׁ")],
		};
		// Start after the ptuha: a Masoretic unit beginning mid-verse must
		// not print the verse's out-of-range side.
		expect(pasukText(pasuk, 2)).toBe("שְׁנַיִם שָׁלִישׁ");
		expect(pasukText(pasuk, undefined, 1)).toBe("אַחַד (פ)");
	});
});

describe("pasukLine", () => {
	it("prefixes the Hebrew letter number", () => {
		const pasuk: Pasuk = { segments: [qri("דָּבָר")] };
		expect(pasukLine(pasuk, 3)).toBe("ג. דָּבָר");
	});
});

describe("scriptureMarkdown", () => {
	it("renders every pasuk of a whole-perek range in order", () => {
		const perek = getPerekByPerekId(1);
		const md = scriptureMarkdown([
			{
				start: { perekId: 1, pasuk: 1 },
				end: { perekId: 1, pasuk: perek.pesukim.length },
			},
		]);
		const lines = md.split("\n");
		expect(lines).toHaveLength(perek.pesukim.length);
		expect(lines[0]).toMatch(/^א\. /);
		expect(lines.at(-1)).toMatch(/^.{1,3}\. /);
	});

	it("labels perek transitions on multi-perek ranges", () => {
		const md = scriptureMarkdown([
			{
				start: { perekId: 1, pasuk: 30 },
				end: { perekId: 2, pasuk: 2 },
			},
		]);
		expect(md).toContain("**בראשית א**");
		expect(md).toContain("**בראשית ב**");
	});

	it("labels each range of a multi-range reading and preserves order", () => {
		const md = scriptureMarkdown([
			{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 2 } },
			{ start: { perekId: 1, pasuk: 2 }, end: { perekId: 1, pasuk: 3 } },
		]);
		const first = md.indexOf("ב. ");
		const second = md.indexOf("ב. ", first + 1);
		// The repeated boundary pasuk is rendered again for the second
		// range — haftara-style readings never deduplicate.
		expect(second).toBeGreaterThan(first);
	});

	it("returns an empty string for no ranges", () => {
		expect(scriptureMarkdown([])).toBe("");
	});
});
