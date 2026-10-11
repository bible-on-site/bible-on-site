import {
	DEFAULT_DIVINE_NAME_MASKING,
	type DivineNameMaskingSettings,
	maskDivineNameText,
	maskDivineNameValue,
} from "@/lib/divine-name-masking";

const enabled = (
	patch: Partial<DivineNameMaskingSettings> = {},
): DivineNameMaskingSettings => ({
	...DEFAULT_DIVINE_NAME_MASKING,
	enabled: true,
	elohim: "hyphen",
	yhwh: "heh",
	el: "hyphen",
	shaddai: "hyphen",
	...patch,
});

describe("maskDivineNameValue", () => {
	describe("when masking is disabled", () => {
		it("returns every name form unchanged", () => {
			for (const value of ["יְהוָ֑ה", "אֱלֹהִ֑ים", "אֵ֑ל", "שַׁדַּ֥י"])
				expect(
					maskDivineNameValue(value, {
						...DEFAULT_DIVINE_NAME_MASKING,
						enabled: false,
					}),
				).toBe(value);
		});
	});

	describe("יהוה", () => {
		const s = enabled();
		it.each([
			["יְהוָ֑ה", "ה'"],
			["יהוה", "ה'"],
			["בַּֽיהוָ֔ה", "בה'"],
			["וַֽיהוָ֖ה", "וה'"],
			["לַ֭יהוָה", "לה'"],
			["וּבַֽיהוָ֔ה", "ובה'"],
		])("masks %s as %s", (value, expected) =>
			expect(maskDivineNameValue(value, s)).toBe(expected),
		);
		it("masks with ד' when chosen", () =>
			expect(maskDivineNameValue("יְהוָ֑ה", enabled({ yhwh: "dalet" }))).toBe(
				"ד'",
			));
		it("masks with the custom text when chosen", () =>
			expect(
				maskDivineNameValue(
					"וַֽיהוָ֖ה",
					enabled({ yhwh: "custom", yhwhCustom: "השם" }),
				),
			).toBe("והשם"));
		it("keeps the word untouched when custom text is blank", () =>
			expect(
				maskDivineNameValue(
					"יְהוָ֑ה",
					enabled({ yhwh: "custom", yhwhCustom: "  " }),
				),
			).toBe("יְהוָ֑ה"));
		it("re-appends trailing paseq and maqaf", () => {
			expect(maskDivineNameValue("יְהוָ֣ה ׀", s)).toBe("ה' ׀");
			expect(maskDivineNameValue("יְהוָה־", s)).toBe("ה'־");
		});
		it("leaves other words alone", () => {
			for (const value of ["יְהוֹשֻׁ֑עַ", "יְהוֹרָ֥ם"])
				expect(maskDivineNameValue(value, s)).toBe(value);
		});
	});

	describe("אלהים", () => {
		const s = enabled();
		it.each([
			["אֱלֹהִ֑ים", "א-להים"],
			["אֱלֹהֵ֗ינוּ", "א-להינו"],
			["אֱלֹהֶֽיךָ", "א-להיך"],
			["אֱלֹהַ֔י", "א-להי"],
			["וְאֱלֹהִ֖ים", "וא-להים"],
			["לֵֽאלֹהִ֑ים", "לא-להים"],
			["מֵהָאֱלֹהִים֙", "מהא-להים"],
			["אֱלָהָ֔א", "א-להא"],
			["אֱלָהֲה֔וֹן", "א-לההון"],
			["אֱלָהֲךְ֙", "א-להך"],
			["אֱלֹהִים־", "א-להים־"],
		])("masks %s as %s", (value, expected) =>
			expect(maskDivineNameValue(value, s)).toBe(expected),
		);
		it.each([
			["אֱלֹהִ֑ים", "אלקים"],
			["אֱלֹהֵ֗ינוּ", "אלקינו"],
			["אֱלֹהַ֔י", "אלקי"],
			["אֱלוֹהַ֥", "אלוקה"],
			["אֱלֹהֵיהֶ֑ם", "אלקיהם"],
			["בֵּאלֹהִ֖ים", "באלקים"],
		])("masks %s as %s with אלקים", (value, expected) =>
			expect(maskDivineNameValue(value, enabled({ elohim: "elokim" }))).toBe(
				expected,
			),
		);
		it("keeps the word as-is when אלהים is chosen", () =>
			expect(
				maskDivineNameValue("אֱלֹהִ֑ים", enabled({ elohim: "asis" })),
			).toBe("אֱלֹהִ֑ים"));
		it("applies custom text to the stem and keeps prefix and suffix", () =>
			expect(
				maskDivineNameValue(
					"וְאֱלֹהֵינוּ֙",
					enabled({ elohim: "custom", elohimCustom: "אלופו" }),
				),
			).toBe("ואלופונו"));
		it("leaves אלה-lookalikes alone", () => {
			for (const value of ["אֵ֣לֶּה", "אֲלֵהֶ֗ם", "אֲלֵהֶ֜ן", "אֵ֥לּוּ"])
				expect(maskDivineNameValue(value, s)).toBe(value);
		});
	});

	describe("אל", () => {
		const s = enabled();
		it.each([
			["אֵ֑ל", "א-ל"],
			["לְאֵ֖ל", "לא-ל"],
			["מֵאֵ֣ל", "מא-ל"],
			["הָאֵ֤ל", "הא-ל"],
			["וְהָאֵל֙", "והא-ל"],
			["בְּאֵ֣ל", "בא-ל"],
			["אֵל־", "א-ל־"],
		])("masks %s as %s", (value, expected) =>
			expect(maskDivineNameValue(value, s)).toBe(expected),
		);
		it("masks unpointed אל (documented ambiguity)", () =>
			expect(maskDivineNameValue("אל", s)).toBe("א-ל"));
		it.each([
			["אֶ֖ל"],
			["אַ֣ל"],
			["אֲלֵהֶ֗ם"],
			["וְאֶל־"],
			["הֹאֶ֖ל"],
			["שְׁאֵ֔ל"],
			["שְׁמוּאֵ֑ל"],
			["דָּנִיֵּ֔אל"],
			["יִשְׂרָאֵֽל"],
			["יִשָּׂאֵ֥ל"],
			["דָּנָאֵ֖ל"],
		])("leaves %s alone", (value) =>
			expect(maskDivineNameValue(value, s)).toBe(value),
		);
		it("leaves אל as-is when that option is chosen", () =>
			expect(maskDivineNameValue("אֵ֑ל", enabled({ el: "asis" }))).toBe(
				"אֵ֑ל",
			));
	});

	describe("שדי", () => {
		const s = enabled();
		it.each([
			["שַׁדַּ֥י", "שד-י"],
			["וְשַׁדַּ֖י", "ושד-י"],
			["שדי", "שד-י"],
		])("masks %s as %s", (value, expected) =>
			expect(maskDivineNameValue(value, s)).toBe(expected),
		);
		it.each([["שְׂדֵ֖י"], ["שָׂדַ֖י"], ["בִּשְׂדֵ֖י"], ["שָׁדַ֖י"]])(
			"leaves %s alone",
			(value) => expect(maskDivineNameValue(value, s)).toBe(value),
		);
		it("masks with custom text when chosen", () =>
			expect(
				maskDivineNameValue(
					"לְשַׁדַּ֥י",
					enabled({ shaddai: "custom", shaddaiCustom: "אל שדי" }),
				),
			).toBe("לאל שדי"));
		it("keeps שדי as-is when that option is chosen", () =>
			expect(maskDivineNameValue("שַׁדַּ֥י", enabled({ shaddai: "asis" }))).toBe(
				"שַׁדַּ֥י",
			));
	});

	it("never leaves orphaned combining marks", () => {
		const s = enabled();
		for (const value of [
			"יְהוָ֣ה ׀",
			"מֵהָאֱלֹהִים֙",
			"וְהָאֵ֤ל",
			"לְשַׁדַּ֥י",
		]) {
			const masked = maskDivineNameValue(value, s);
			expect(masked.normalize("NFD")).toMatch(/^[^\p{Mn}\p{Mc}]*$/u);
		}
	});

	it("does not touch ptuha/stuma markers or non-Hebrew text", () => {
		const s = enabled();
		for (const value of ["פ", "ס", "׀", "12:34", ""])
			expect(maskDivineNameValue(value, s)).toBe(value);
	});
});

describe("maskDivineNameText", () => {
	it("masks every divine-name word in a pasuk string", () =>
		expect(
			maskDivineNameText(
				"וַיִּשְׁמַ֤ע יְהוָה֙ וַיִּתְאַנַּ֥ף בְּיִשְׂרָאֵ֑ל",
				enabled(),
			),
		).toBe("וַיִּשְׁמַ֤ע ה' וַיִּתְאַנַּ֥ף בְּיִשְׂרָאֵ֑ל"));
	it("handles maqaf-joined compounds word-by-word", () =>
		expect(
			maskDivineNameText("יְהוָה־אֱלֹהֵינוּ֙", enabled()),
		).toBe("ה'־א-להינו"));
	it("returns text unchanged when disabled", () =>
		expect(
			maskDivineNameText("יְהוָ֑ה אֱלֹהִ֖ים", {
				...DEFAULT_DIVINE_NAME_MASKING,
				enabled: false,
			}),
		).toBe("יְהוָ֑ה אֱלֹהִ֖ים"));
});
