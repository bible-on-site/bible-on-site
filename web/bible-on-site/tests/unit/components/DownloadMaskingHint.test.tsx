/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { DownloadMaskingHint } from "@/app/929/[number]/components/DownloadMaskingHint";
import { OPEN_READER_SETTINGS_EVENT } from "@/lib/recitation-settings";

jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({
	downloadHint: "downloadHint",
	downloadHintLink: "downloadHintLink",
}));

describe("DownloadMaskingHint", () => {
	it("renders the hint and opens the display settings on click", () => {
		render(<DownloadMaskingHint />);
		const link = screen.getByRole("button", { name: "הסתרת שם השם" });
		expect(link.parentElement).toHaveTextContent("מומלץ לבחון הסתרת שם השם");

		const opened = jest.fn();
		window.addEventListener(OPEN_READER_SETTINGS_EVENT, opened);
		fireEvent.click(link);
		window.removeEventListener(OPEN_READER_SETTINGS_EVENT, opened);
		expect(opened).toHaveBeenCalledTimes(1);
		expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({
			section: "display",
			opener: link,
			scoped: false,
		});
	});
});
