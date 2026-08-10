import type { Pasuk } from "@/data/db/tanah-view-types";
import { pasukPlainText } from "@/lib/tanach/pasuk-plain-text";

function pasuk(segments: Pasuk["segments"]): Pasuk {
	return { segments } as Pasuk;
}

function mockTimeframe() {
	return {
		from: { type: "string", pattern: "^\\d{2}:\\d{2}:\\d{2}$" },
		to: { type: "string", pattern: "^\\d{2}:\\d{2}:\\d{2}$" },
	} as const;
}

describe("pasukPlainText", () => {
	it("joins regular qri segments with spaces", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "וַיְהִי", recordingTimeFrame: mockTimeframe() },
					{ type: "qri", value: "בָעֶרֶב", recordingTimeFrame: mockTimeframe() },
				]),
			),
		).toBe("וַיְהִי בָעֶרֶב");
	});

	it("glues a word after a maqaf without a space", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "אֶת־", recordingTimeFrame: mockTimeframe() },
					{ type: "qri", value: "לֵאָה", recordingTimeFrame: mockTimeframe() },
				]),
			),
		).toBe("אֶת־לֵאָה");
	});

	it("skips section marks", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "דָּן", recordingTimeFrame: mockTimeframe() },
					{ type: "ptuha" },
					{ type: "stuma" },
				]),
			),
		).toBe("דָּן");
	});

	it("skips ktiv variants that have a differing qri pair", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "ktiv", value: "כתיב", qriOffset: 1 },
					{
						type: "qri",
						value: "קרי",
						recordingTimeFrame: mockTimeframe(),
						ktivOffset: -1,
					},
				]),
			),
		).toBe("קרי");
	});

	it("keeps orphan ktiv (qriOffset 0)", () => {
		expect(
			pasukPlainText(
				pasuk([{ type: "ktiv", value: "יתום", qriOffset: 0 }]),
			),
		).toBe("יתום");
	});
});
