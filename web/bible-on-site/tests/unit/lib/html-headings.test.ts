import { demoteHeadings } from "@/lib/html-headings";

describe("demoteHeadings", () => {
	it("rewrites h1-h5 one level deeper so embedded content emits no h1", () => {
		expect(
			demoteHeadings("<h1>א</h1><h2>ב</h2><h5>ה</h5><h6>ו</h6>"),
		).toBe("<h2>א</h2><h3>ב</h3><h6>ה</h6><h6>ו</h6>");
	});

	it("preserves attributes on rewritten headings", () => {
		expect(demoteHeadings('<h1 class="x" dir="rtl">א</h1>')).toBe(
			'<h2 class="x" dir="rtl">א</h2>',
		);
	});

	it("matches heading tags case-insensitively", () => {
		expect(demoteHeadings("<H1>א</H1>")).toBe("<h2>א</h2>");
	});

	it("leaves non-heading markup untouched", () => {
		expect(demoteHeadings("<p><b>א</b></p>")).toBe("<p><b>א</b></p>");
	});
});
