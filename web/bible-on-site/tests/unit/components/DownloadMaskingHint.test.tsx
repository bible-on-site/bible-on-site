/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { DownloadMaskingHint } from "@/app/929/[number]/components/DownloadMaskingHint";
import { OPEN_READER_SETTINGS_EVENT } from "@/lib/recitation-settings";

jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({
	downloadHint: "downloadHint",
	downloadHintLink: "downloadHintLink",
}));

function Harness({ open }: { open: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div ref={ref}>
			{open && (
				<div className="flipbook-toolbar-download-menu" data-testid="menu" />
			)}
			<DownloadMaskingHint toolbarRef={ref} />
		</div>
	);
}

describe("DownloadMaskingHint", () => {
	it("renders inside the open download menu and opens the display settings", async () => {
		const { rerender } = render(<Harness open={false} />);
		expect(screen.queryByText("מומלץ לבחון", { exact: false })).toBeNull();

		await act(async () => rerender(<Harness open />));
		const link = screen.getByRole("button", { name: "הסתרת שם השם" });
		expect(screen.getByTestId("menu")).toContainElement(link);
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

		await act(async () => rerender(<Harness open={false} />));
		expect(screen.queryByRole("button", { name: "הסתרת שם השם" })).toBeNull();
	});
});
