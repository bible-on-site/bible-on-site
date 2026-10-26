/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

import { CalendarPdfDownload } from "@/app/calendar/components/CalendarPdfDownload";

const PDF_URL = "/api/calendar-pdf?month=578512&view=month&cycle=4";
const SCOPE = "אלול ה'תשפ\"ה";

function pdfResponse(
	ok: boolean,
	disposition = 'attachment; filename="learning-calendar-578512.pdf"',
) {
	return {
		ok,
		status: ok ? 200 : 500,
		headers: new Headers(
			disposition ? { "Content-Disposition": disposition } : {},
		),
		blob: () =>
			Promise.resolve(new Blob(["%PDF"], { type: "application/pdf" })),
	} as Response;
}

/** A promise the test resolves by hand so mid-flight state is observable. */
function deferred<T>(value: T) {
	let resolve!: () => void;
	const promise = new Promise<T>((res) => {
		resolve = () => res(value);
	});
	return { promise, resolve };
}

describe("CalendarPdfDownload", () => {
	beforeEach(() => {
		global.fetch = jest.fn();
		URL.createObjectURL = jest.fn(() => "blob:mock");
		URL.revokeObjectURL = jest.fn();
		jest
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("renders an accessible action labelled with the selected period", () => {
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		expect(
			screen.getByRole("button", { name: `הורדת PDF: ${SCOPE}` }),
		).toBeInTheDocument();
		expect(screen.getByText(SCOPE)).toBeInTheDocument();
	});

	it("performs no PDF fetch before the user activates the action", () => {
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("fetches the current URL on activation and downloads via the response filename", async () => {
		const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");
		(global.fetch as jest.Mock).mockResolvedValue(pdfResponse(true));
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		expect(global.fetch).toHaveBeenCalledWith(PDF_URL);
		const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.download).toBe("learning-calendar-578512.pdf");
		expect(anchor.href).toBe("blob:mock");
	});

	it("falls back to a default filename when the response hides its header", async () => {
		const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");
		(global.fetch as jest.Mock).mockResolvedValue(pdfResponse(true, ""));
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() => expect(clickSpy).toHaveBeenCalled());
		expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).download).toBe(
			"learning-calendar.pdf",
		);
	});

	it("reports preparing then downloading while a slow request proceeds", async () => {
		const gate = deferred(pdfResponse(true));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`מכין PDF של ${SCOPE}`,
			),
		);
		gate.resolve();
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
	});

	it("keeps the started period's identity when the view changes mid-flight", async () => {
		const gate = deferred(pdfResponse(true));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { rerender } = render(
			<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		rerender(
			<CalendarPdfDownload
				url="/api/calendar-pdf?month=578601&view=month&cycle=4"
				scopeLabel={"תשרי ה'תשפ\"ו"}
			/>,
		);
		gate.resolve();

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
	});

	it("prevents a second request while one is in flight", async () => {
		const gate = deferred(pdfResponse(true));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		const button = screen.getByRole("button", { name: /הורדת PDF/ });
		fireEvent.click(button);
		fireEvent.click(button);

		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(button).toBeDisabled();
		gate.resolve();
		await waitFor(() => expect(button).not.toBeDisabled());
	});

	it("shows a retryable error status after a failed response", async () => {
		(global.fetch as jest.Mock).mockResolvedValue(pdfResponse(false));
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} נכשלה`,
			),
		);
		expect(
			screen.getByRole("button", { name: /הורדת PDF/ }),
		).not.toBeDisabled();
	});

	it("recovers on retry and announces the download start", async () => {
		(global.fetch as jest.Mock)
			.mockResolvedValueOnce(pdfResponse(false))
			.mockResolvedValueOnce(pdfResponse(true));
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		const button = screen.getByRole("button", { name: /הורדת PDF/ });
		fireEvent.click(button);
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("נכשלה"),
		);
		fireEvent.click(button);

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		expect(global.fetch).toHaveBeenCalledTimes(2);
	});

	it("still downloads under Strict Mode effect replay", async () => {
		(global.fetch as jest.Mock).mockResolvedValue(pdfResponse(true));
		render(
			<StrictMode>
				<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />
			</StrictMode>,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
	});

	it("surfaces a network failure as a retryable error", async () => {
		(global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
		render(<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("נכשלה"),
		);
	});

	it("ignores a response that resolves after unmount", async () => {
		const gate = deferred(pdfResponse(true));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { unmount } = render(
			<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		unmount();
		gate.resolve();

		await waitFor(() => expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled());
	});

	it("ignores a blob that resolves after unmount", async () => {
		const blobGate = deferred(new Blob(["%PDF"], { type: "application/pdf" }));
		(global.fetch as jest.Mock).mockResolvedValue({
			...pdfResponse(true),
			blob: () => blobGate.promise,
		});
		const { unmount } = render(
			<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("מוריד"),
		);
		unmount();
		blobGate.resolve();

		await waitFor(() => expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled());
	});

	it("ignores a rejection that arrives after unmount", async () => {
		const gate = deferred(pdfResponse(false));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { unmount } = render(
			<CalendarPdfDownload url={PDF_URL} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		unmount();
		gate.resolve();

		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
	});
});
