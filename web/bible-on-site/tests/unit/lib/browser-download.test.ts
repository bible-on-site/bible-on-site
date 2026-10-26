import { attachmentFilename } from "@/lib/download/browser-download";

describe("attachmentFilename", () => {
	it("returns the quoted filename from a Content-Disposition header", () => {
		expect(
			attachmentFilename(
				'attachment; filename="learning-calendar-578512.pdf"',
				"fallback.pdf",
			),
		).toBe("learning-calendar-578512.pdf");
	});

	it("returns the bare-token filename form", () => {
		expect(
			attachmentFilename("attachment; filename=calendar.pdf", "fallback.pdf"),
		).toBe("calendar.pdf");
	});

	it("prefers a UTF-8 filename* over the plain filename", () => {
		expect(
			attachmentFilename(
				"attachment; filename=\"cal.pdf\"; filename*=UTF-8''%D7%9C%D7%95%D7%97.pdf",
				"fallback.pdf",
			),
		).toBe("לוח.pdf");
	});

	it("falls back when the header is absent", () => {
		expect(attachmentFilename(null, "fallback.pdf")).toBe("fallback.pdf");
	});

	it("falls back when the header carries no filename", () => {
		expect(attachmentFilename("attachment", "fallback.pdf")).toBe(
			"fallback.pdf",
		);
	});
});
