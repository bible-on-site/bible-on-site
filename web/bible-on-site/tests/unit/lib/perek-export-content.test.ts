const mockToBuffer = jest.fn(async () => Buffer.from("jpeg-bytes"));
const mockSharp = jest.fn(() => ({
	resize: jest.fn().mockReturnThis(),
	jpeg: jest.fn().mockReturnThis(),
	toBuffer: mockToBuffer,
}));
jest.mock("sharp", () => ({
	__esModule: true,
	default: (...args: unknown[]) => mockSharp(...(args as [])),
}));

const mockImagesByPerek = jest.fn();
jest.mock("@/lib/seo/perek-images-data", () => ({
	getPerekImagesByChapter: () => mockImagesByPerek(),
}));

jest.mock("@/data/perek-dto", () => ({
	getPerekByPerekId: (perekId: number) => ({
		perekId,
		sefer: "בראשית",
		perekHeb: perekId === 8 ? "ח" : "א",
		pesukim: [
			{
				segments: [
					{ type: "qri", value: "וַיֹּ֥אמֶר" },
					{ type: "qri", value: "אֱלֹהִ֖ים" },
					{ type: "ktiv", value: "הוצא", qriOffset: 1 },
					{ type: "qri", value: "הַיְצֵ֣א", ktivOffset: -1 },
					{ type: "ptuha" },
				],
			},
		],
	}),
}));

import {
	DEFAULT_DIVINE_NAME_MASKING,
	maskDivineNameValue,
} from "@/lib/divine-name-masking";
import { ExportError } from "@/lib/download/export-error";
import { buildPerakimContent } from "@/lib/download/perek-export-content";
import { perekImageUrl } from "@/lib/seo/perek-illustrations";

const image = (src: string, caption = "") => ({ src, caption });
const okResponse = { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };

describe("buildPerakimContent", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockImagesByPerek.mockResolvedValue({});
		global.fetch = jest.fn(async () => okResponse) as unknown as typeof fetch;
	});

	it("keeps קרי/כתיב structure and drops ptuha/stuma markers", async () => {
		const [content] = await buildPerakimContent([8], {
			...DEFAULT_DIVINE_NAME_MASKING,
			enabled: false,
		});
		expect(content).toEqual({
			perekId: 8,
			pesukim: [
				[
					{ kind: "word", value: "וַיֹּ֥אמֶר" },
					{ kind: "word", value: "אֱלֹהִ֖ים" },
					{ kind: "ktiv", value: "הוצא" },
					{ kind: "qri", value: "הַיְצֵ֣א" },
				],
			],
			images: [],
		});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("applies the reader's divine-name masking via the shared policy", async () => {
		const masking = {
			...DEFAULT_DIVINE_NAME_MASKING,
			enabled: true,
			elohim: "custom" as const,
			elohimCustom: "אלוקי",
		};
		const [content] = await buildPerakimContent([1], masking);
		const masked = maskDivineNameValue("אֱלֹהִ֖ים", masking);
		expect(masked).not.toBe("אֱלֹהִ֖ים");
		expect(content.pesukim[0][1]).toEqual({ kind: "word", value: masked });
		expect(content.pesukim[0][0].value).toBe("וַיֹּ֥אמֶר");
	});

	it("embeds every perek illustration as a resized JPEG", async () => {
		mockImagesByPerek.mockResolvedValue({
			1: [
				image(perekImageUrl("perakim/1.webp"), "בריאה"),
				image(perekImageUrl("perakim/2.webp")),
			],
		});
		const [content] = await buildPerakimContent(
			[1],
			DEFAULT_DIVINE_NAME_MASKING,
		);
		expect(global.fetch).toHaveBeenCalledWith(
			new URL(perekImageUrl("perakim/1.webp")),
		);
		expect(global.fetch).toHaveBeenCalledWith(
			new URL(perekImageUrl("perakim/2.webp")),
		);
		expect(content.images).toEqual([
			{ dataBase64: "anBlZy1ieXRlcw==", ext: "jpg", caption: "בריאה" },
			{ dataBase64: "anBlZy1ieXRlcw==", ext: "jpg", caption: "" },
		]);
	});

	it("refuses to fetch illustrations from another host", async () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockImagesByPerek.mockResolvedValue({
			1: [image("https://evil.example/x.webp")],
		});
		await expect(
			buildPerakimContent([1], DEFAULT_DIVINE_NAME_MASKING),
		).rejects.toBeInstanceOf(ExportError);
		expect(global.fetch).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("reports a failing illustration with an actionable error", async () => {
		const consoleSpy = jest
			.spyOn(console, "error")
			.mockImplementation(() => {});
		mockImagesByPerek.mockResolvedValue({
			8: [image(perekImageUrl("perakim/broken.webp"))],
		});
		global.fetch = jest.fn(async () => ({
			ok: false,
			status: 403,
		})) as unknown as typeof fetch;
		const result = buildPerakimContent([8], DEFAULT_DIVINE_NAME_MASKING);
		await expect(result).rejects.toBeInstanceOf(ExportError);
		await expect(result).rejects.toThrow(
			"לא ניתן היה לטעון את האיור של בראשית ח. נסו להוריד שוב בעוד רגע.",
		);
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});
