import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const statusMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/website-revalidate", () => ({
	getWebsiteRevalidationStatus: statusMock,
}));

import { RevalidationWarning } from "~/components/RevalidationWarning";

function renderWarning() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<RevalidationWarning />
		</QueryClientProvider>,
	);
}

describe("RevalidationWarning", () => {
	it("renders nothing while invalidations succeed", async () => {
		statusMock.mockResolvedValue({ lastFailure: null });

		const { container } = render(
			<QueryClientProvider
				client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
			>
				<RevalidationWarning />
			</QueryClientProvider>,
		);

		await waitFor(() => expect(statusMock).toHaveBeenCalled());
		expect(container).toBeEmptyDOMElement();
	});

	it("warns the editor when the last invalidation did not apply", async () => {
		statusMock.mockResolvedValue({
			lastFailure: {
				failedAt: "2026-02-12T10:00:00.000Z",
				requests: [{ tag: "articles" }],
			},
		});
		renderWarning();

		expect(
			await screen.findByText(/עדכון האתר נכשל/),
		).toBeInTheDocument();
	});

	it("names the config gap when the endpoint is not configured", async () => {
		statusMock.mockResolvedValue({
			lastFailure: {
				failedAt: "2026-02-12T10:00:00.000Z",
				requests: [{ tag: "articles" }],
				unconfigured: true,
			},
		});
		renderWarning();

		expect(
			await screen.findByText(/אינו מוגדר בשרת/),
		).toBeInTheDocument();
	});
});
