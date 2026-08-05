import type { Pasuk } from "@/data/db/tanah-view-types";
import { pasukPlainText } from "@/lib/tanach/pasuk-plain-text";

function pasuk(segments: Pasuk["segments"]): Pasuk {
	return { segments } as Pasuk;
}

describe("pasukPlainText", () => {
	it("joins regular qri segments with spaces", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "וַיְהִי", recordingTimeFrame: [0, 1] },
					{ type: "qri", value: "בָעֶרֶב", recordingTimeFrame: [1, 2] },
				] as Pasuk["segments"]),
			),
		).toBe("וַיְהִי בָעֶרֶב");
	});

	it("glues a word after a maqaf without a space", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "אֶת־", recordingTimeFrame: [0, 1] },
					{ type: "qri", value: "לֵאָה", recordingTimeFrame: [1, 2] },
				] as Pasuk["segments"]),
			),
		).toBe("אֶת־לֵאָה");
	});

	it("skips section marks", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "qri", value: "דָּן", recordingTimeFrame: [0, 1] },
					{ type: "ptuha" },
					{ type: "stuma" },
				] as Pasuk["segments"]),
			),
		).toBe("דָּן");
	});

	it("skips ktiv variants that have a differing qri pair", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "ktiv", value: "כתיב", qriOffset: 1 },
					{ type: "qri", value: "קרי", recordingTimeFrame: [0, 1], ktivOffset: -1 },
				] as Pasuk["segments"]),
			),
		).toBe("קרי");
	});

	it("keeps orphan ktiv (qriOffset 0)", () => {
		expect(
			pasukPlainText(
				pasuk([
					{ type: "ktiv", value: "יתום", qriOffset: 0 },
				] as Pasuk["segments"]),
			),
		).toBe("יתום");
	});
});
