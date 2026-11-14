/**
 * @jest-environment jsdom
 */
import {
	attachmentFilename,
	triggerBrowserDownload,
} from "@/lib/download/browser-download";

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

	it("warns and uses the plain filename when filename* is malformed", () => {
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		try {
			expect(
				attachmentFilename(
					"attachment; filename*=UTF-8''%E0%A4%A; filename=\"cal.pdf\"",
					"fallback.pdf",
				),
			).toBe("cal.pdf");
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("filename* is malformed"),
				expect.any(Error),
			);
		} finally {
			warn.mockRestore();
		}
	});

	it("falls through to the plain filename when filename* decodes empty", () => {
		expect(
			attachmentFilename(
				"attachment; filename*=UTF-8''; filename=\"cal.pdf\"",
				"fallback.pdf",
			),
		).toBe("cal.pdf");
	});
});

describe("triggerBrowserDownload", () => {
	beforeEach(() => {
		jest.useFakeTimers();
		URL.createObjectURL = jest.fn(() => "blob:mock");
		URL.revokeObjectURL = jest.fn();
		jest
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it("clicks a temporary anchor carrying the blob URL and filename", () => {
		const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

		triggerBrowserDownload(new Blob(["%PDF"]), "calendar.pdf");

		expect(clickSpy).toHaveBeenCalledTimes(1);
		const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.href).toBe("blob:mock");
		expect(anchor.download).toBe("calendar.pdf");
		expect(anchor.isConnected).toBe(false);
	});

	it("keeps the blob URL alive past the click so queued downloads survive", () => {
		triggerBrowserDownload(new Blob(["%PDF"]), "calendar.pdf");

		jest.advanceTimersByTime(1000);
		expect(URL.revokeObjectURL).not.toHaveBeenCalled();
		jest.runAllTimers();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
	});
});
