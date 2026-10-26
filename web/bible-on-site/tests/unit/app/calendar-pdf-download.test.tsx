/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

import {
	CalendarPdfDownload,
	type CalendarPdfRequest,
} from "@/app/calendar/components/CalendarPdfDownload";
import { resetCalendarPdfAssetCache } from "@/lib/download/calendar-pdf-client";

const MANIFEST_URL =
	"https://assets.example/generated/calendar-pdf/manifest.json";
const ASSET_OBJECT = "generated/calendar-pdf/objects/deadbeef.pdf";
const ASSET_URL = `https://assets.example/${ASSET_OBJECT}`;
const API_URL = "/api/calendar-pdf?month=578512&view=month&cycle=4";
const SCOPE = "אלול ה'תשפ\"ה";

const REQUEST: CalendarPdfRequest = {
	artifactKey: "month:578512",
	manifestUrl: MANIFEST_URL,
	filename: "learning-calendar-578512.pdf",
	apiUrl: API_URL,
};

function manifestResponse(artifacts: Record<string, unknown> = {}) {
	// jsdom has no fetch Response class — a structural stub is enough.
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		text: () =>
			Promise.resolve(
				JSON.stringify({
					version: 1,
					fingerprint: "fp",
					generatedAt: "2026-10-26T00:00:00.000Z",
					bounds: {
						minYear: 5775,
						maxYear: 5821,
						maxCycle: 13,
						minMonth: "577501",
						maxMonth: "582112",
					},
					artifacts: {
						"month:578512": {
							object: ASSET_OBJECT,
							sha256: "a".repeat(64),
							bytes: 42,
							filename: "learning-calendar-578512.pdf",
						},
						...artifacts,
					},
				}),
			),
	} as Response;
}

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

function pdfStatusResponse(status: number) {
	return {
		ok: false,
		status,
		headers: new Headers(),
	} as Response;
}

/** fetch(mock) that serves the manifest from MANIFEST_URL and delegates
 * other URLs to `fallback` (defaults to a successful PDF response). */
function mockFetch(
	fallback: () => Promise<Response> | Response = () => pdfResponse(true),
) {
	(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
		url === MANIFEST_URL
			? Promise.resolve(manifestResponse())
			: Promise.resolve(fallback()),
	);
}

/** A promise the test resolves by hand so mid-flight state is observable. */
function deferred<T>(value: T) {
	let resolve!: () => void;
	const promise = new Promise<T>((res) => {
		resolve = () => res(value);
	});
	return { promise, resolve };
}

function clickSpy() {
	return jest.spyOn(HTMLAnchorElement.prototype, "click");
}

describe("CalendarPdfDownload", () => {
	beforeEach(() => {
		resetCalendarPdfAssetCache();
		global.fetch = jest.fn();
		URL.createObjectURL = jest.fn(() => "blob:mock");
		URL.revokeObjectURL = jest.fn();
		clickSpy().mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("renders an accessible action labelled with the selected period", () => {
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		expect(
			screen.getByRole("button", { name: `הורדת PDF: ${SCOPE}` }),
		).toBeInTheDocument();
		expect(screen.getByText(SCOPE)).toBeInTheDocument();
	});

	it("performs no fetch before the user activates the action", () => {
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("hands the published object URL to the browser without calling the API", async () => {
		const spy = clickSpy();
		mockFetch();
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		// Exactly one request: the static manifest — never the legacy API.
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(global.fetch).toHaveBeenCalledWith(
			MANIFEST_URL,
			expect.objectContaining({ cache: "no-store" }),
		);
		const anchor = spy.mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.href).toBe(ASSET_URL);
		expect(anchor.download).toBe("learning-calendar-578512.pdf");
		// No _blank: a post-await new-context open would be popup-blockable;
		// same-tab click on an attachment response downloads in place.
		expect(anchor.target).not.toBe("_blank");
		expect(anchor.rel).toContain("noopener");
	});

	it("reuses the cached manifest on a repeated download", async () => {
		const spy = clickSpy();
		mockFetch();
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);
		const button = screen.getByRole("button", { name: /הורדת PDF/ });

		fireEvent.click(button);
		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("החלה"),
		);
		fireEvent.click(button);
		await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("prevents a second request while one is in flight", async () => {
		const gate = deferred(manifestResponse());
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		const button = screen.getByRole("button", { name: /הורדת PDF/ });
		fireEvent.click(button);
		fireEvent.click(button);

		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(button).toBeDisabled();
		gate.resolve();
		await waitFor(() => expect(button).not.toBeDisabled());
	});

	it("keeps the started period's identity when the view changes mid-flight", async () => {
		const gate = deferred(manifestResponse());
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { rerender } = render(
			<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		rerender(
			<CalendarPdfDownload
				request={{
					artifactKey: "month:578601",
					manifestUrl: MANIFEST_URL,
					filename: "learning-calendar-578601.pdf",
					apiUrl: "/api/calendar-pdf?month=578601&view=month&cycle=4",
				}}
				scopeLabel={"תשרי ה'תשפ\"ו"}
			/>,
		);
		gate.resolve();

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		const anchor = clickSpy().mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.href).toBe(ASSET_URL);
	});

	it("falls back to the legacy API URL when the key is not published", async () => {
		const spy = clickSpy();
		mockFetch(() => pdfResponse(true));
		render(
			<CalendarPdfDownload
				request={{ ...REQUEST, artifactKey: "cycle:99" }}
				scopeLabel={SCOPE}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		expect(global.fetch).toHaveBeenCalledWith(API_URL);
		const anchor = spy.mock.contexts[0] as HTMLAnchorElement;
		expect(anchor.href).toBe("blob:mock");
	});

	it("falls back to the legacy API URL when the manifest cannot be fetched", async () => {
		(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
			url === MANIFEST_URL
				? Promise.reject(new Error("offline"))
				: Promise.resolve(pdfResponse(true)),
		);
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`הורדת PDF של ${SCOPE} החלה`,
			),
		);
		expect(global.fetch).toHaveBeenCalledWith(API_URL);
	});

	it("reports 'being prepared' when the compatibility route answers 503", async () => {
		mockFetch(() => pdfStatusResponse(503));
		render(
			<CalendarPdfDownload
				request={{ ...REQUEST, artifactKey: "cycle:99" }}
				scopeLabel={SCOPE}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`PDF של ${SCOPE} עדיין בהכנה`,
			),
		);
		expect(
			screen.getByRole("button", { name: /הורדת PDF/ }),
		).not.toBeDisabled();
	});

	it("reports 'unavailable' when the compatibility route answers 404", async () => {
		mockFetch(() => pdfStatusResponse(404));
		render(
			<CalendarPdfDownload
				request={{ ...REQUEST, artifactKey: "cycle:99" }}
				scopeLabel={SCOPE}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent(
				`PDF של ${SCOPE} אינו זמין`,
			),
		);
	});

	it("shows a retryable error status after a failed response", async () => {
		mockFetch(() => pdfStatusResponse(500));
		render(
			<CalendarPdfDownload
				request={{ ...REQUEST, artifactKey: "cycle:99" }}
				scopeLabel={SCOPE}
			/>,
		);

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

	it("falls back to the artifact filename when the response hides its header", async () => {
		const spy = clickSpy();
		mockFetch(() => pdfResponse(true, ""));
		render(
			<CalendarPdfDownload
				request={{ ...REQUEST, artifactKey: "cycle:99" }}
				scopeLabel={SCOPE}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() => expect(spy).toHaveBeenCalled());
		expect((spy.mock.contexts[0] as HTMLAnchorElement).download).toBe(
			"learning-calendar-578512.pdf",
		);
	});

	it("recovers on retry and announces the download start", async () => {
		// First attempt: manifest unreachable AND the legacy route fails; the
		// second click rides the cached manifest-miss onto the now-healthy API.
		(global.fetch as jest.Mock)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(pdfStatusResponse(500))
			.mockImplementation((url: unknown) =>
				url === MANIFEST_URL
					? Promise.resolve(manifestResponse())
					: Promise.resolve(pdfResponse(true)),
			);
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

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
		expect(global.fetch).toHaveBeenCalledTimes(3);
	});

	it("still downloads under Strict Mode effect replay", async () => {
		mockFetch();
		render(
			<StrictMode>
				<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />
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
		// Manifest and compatibility-route fetches are both offline.
		(global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
		render(<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

		await waitFor(() =>
			expect(screen.getByRole("status")).toHaveTextContent("נכשלה"),
		);
	});

	it("ignores a manifest resolution that completes after unmount", async () => {
		const gate = deferred(manifestResponse());
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { unmount } = render(
			<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		unmount();
		gate.resolve();

		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
		expect(clickSpy()).not.toHaveBeenCalled();
	});

	it("ignores a fallback response that resolves after unmount", async () => {
		const manifestGate = deferred(pdfStatusResponse(404));
		const apiGate = deferred(pdfResponse(true));
		(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
			url === MANIFEST_URL ? manifestGate.promise : apiGate.promise,
		);
		const { unmount } = render(
			<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		manifestGate.resolve();
		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith(API_URL),
		);
		unmount();
		apiGate.resolve();

		await waitFor(() =>
			expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(),
		);
	});

	it("ignores a rejection that arrives after unmount", async () => {
		const gate = deferred(pdfStatusResponse(500));
		(global.fetch as jest.Mock).mockReturnValue(gate.promise);
		const { unmount } = render(
			<CalendarPdfDownload request={REQUEST} scopeLabel={SCOPE} />,
		);

		fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));
		unmount();
		gate.resolve();

		await waitFor(() => expect(global.fetch).toHaveBeenCalled());
	});
});
