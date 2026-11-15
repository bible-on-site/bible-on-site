import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContributionAgentSummary } from "~/lib/tanahpedia/contribution-agents";

const mocks = vi.hoisted(() => ({
	list: vi.fn(),
	install: vi.fn(),
	update: vi.fn(),
}));
vi.mock("~/server/tanahpedia/contributions", () => ({
	getContributionAgents: mocks.list,
	installContributionAgent: mocks.install,
	updateContributionAgent: mocks.update,
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		search: _search,
		...props
	}: {
		to: string;
		children: React.ReactNode;
		search?: unknown;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
	createFileRoute: () => (config: unknown) => config,
}));

import { ContributionAgents } from "~/components/tanahpedia/ContributionAgents";
import { Route } from "~/routes/contribution-agents";

function agent(
	overrides: Partial<ContributionAgentSummary> = {},
): ContributionAgentSummary {
	return {
		id: "agent-1",
		version: 2,
		name: "Workstation",
		provider: "local_llm",
		model: "qwen3:8b",
		enabled: true,
		installedVersion: "1.0",
		bundleHash: "hash",
		latestVersion: "2.0",
		updateAvailable: true,
		createdAt: "2026-11-15T00:00:00Z",
		updatedAt: "2026-11-15T00:00:00Z",
		lastSeenAt: null,
		runtimeVersion: null,
		...overrides,
	};
}
let current: ContributionAgentSummary[], client: QueryClient;
function show() {
	client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ContributionAgents />
		</QueryClientProvider>,
	);
}
async function card() {
	return screen.findByRole("article", { name: "Workstation" });
}
describe("versioned agent configuration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		current = [agent()];
		mocks.list.mockImplementation(async () => current);
		mocks.install.mockImplementation(async ({ data }) => {
			const installed = agent({ id: "new-agent", ...data });
			current = [...current, installed];
			return installed;
		});
		mocks.update.mockImplementation(async ({ data }) => {
			const updated = agent({
				...current[0],
				...data,
				version: data.version + 1,
				...(data.action === "upgrade"
					? { installedVersion: "2.0", updateAvailable: false }
					: {}),
			});
			current = [updated];
			return updated;
		});
	});
	it("registers the route and displays state without changing any agent", async () => {
		expect((Route as unknown as { component: unknown }).component).toBe(
			ContributionAgents,
		);
		show();
		await card();
		expect(
			screen.getByRole("option", { name: "Local LLM - עובד בתחנת העבודה" }),
		).toHaveValue("local_llm");
		expect(screen.getByRole("option", { name: "AWS LLM" })).toHaveValue(
			"aws_llm",
		);
		expect(screen.getByText("טרם התחבר")).toBeInTheDocument();
		expect(screen.getByText(/בסביבות הרצה קיימות/)).toBeInTheDocument();
		expect(mocks.install).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});
	it("installs a versioned AWS configuration with the runtime's default model", async () => {
		show();
		const form = await screen.findByRole("form", { name: "התקנת הגדרת סוכן" });
		fireEvent.change(within(form).getByLabelText("שם הסוכן"), {
			target: { value: " AWS helper " },
		});
		fireEvent.change(within(form).getByLabelText("סביבת הרצה"), {
			target: { value: "aws_llm" },
		});
		expect(within(form).getByLabelText("מודל")).toHaveValue("");
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.install).toHaveBeenCalledWith({
				data: {
					name: "AWS helper",
					provider: "aws_llm",
					model: null,
					enabled: true,
				},
			}),
		);
		expect(
			await screen.findByRole("article", { name: "AWS helper" }),
		).toBeInTheDocument();
		expect(within(form).getByLabelText("שם הסוכן")).toHaveValue("");
	});
	it("sends the optimistic config version and retains edits after a rejected update", async () => {
		mocks.update.mockRejectedValue(new Error("Configuration changed; reload"));
		show();
		const region = await card();
		const form = within(region).getByRole("form");
		fireEvent.change(within(form).getByLabelText("שם הסוכן"), {
			target: { value: " My helper " },
		});
		fireEvent.change(within(form).getByLabelText("מודל"), {
			target: { value: "new-model" },
		});
		fireEvent.click(within(form).getByRole("checkbox"));
		fireEvent.submit(form);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: {
					id: "agent-1",
					version: 2,
					action: "configure",
					name: "My helper",
					model: "new-model",
					enabled: false,
				},
			}),
		);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Configuration changed; reload",
		);
		expect(within(form).getByLabelText("שם הסוכן")).toHaveValue(" My helper ");
	});
	it("upgrades instructions without overwriting an unsaved configuration draft", async () => {
		show();
		const region = await card();
		fireEvent.change(within(region).getByLabelText("שם הסוכן"), {
			target: { value: "Unsaved helper" },
		});
		fireEvent.click(
			within(region).getByRole("button", { name: "עדכון הוראות וכלים" }),
		);
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith({
				data: { id: "agent-1", version: 2, action: "upgrade" },
			}),
		);
		expect(
			await screen.findByText("ההוראות והכלים מעודכנים"),
		).toBeInTheDocument();
		expect(within(region).getByLabelText("שם הסוכן")).toHaveValue(
			"Unsaved helper",
		);
		fireEvent.submit(within(region).getByRole("form"));
		await waitFor(() =>
			expect(mocks.update).toHaveBeenLastCalledWith({
				data: {
					id: "agent-1",
					version: 3,
					action: "configure",
					name: "Unsaved helper",
					model: "qwen3:8b",
					enabled: true,
				},
			}),
		);
	});
	it("preserves a dirty draft through refresh and requires explicitly loading the concurrent version", async () => {
		show();
		const region = await card();
		fireEvent.change(within(region).getByLabelText("שם הסוכן"), {
			target: { value: "My draft" },
		});
		current = [
			agent({
				version: 3,
				model: "someone-else",
				lastSeenAt: "2026-11-15T12:00:00Z",
				runtimeVersion: "worker-v2",
				enabled: false,
			}),
		];
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
		expect(await screen.findByText(/הטיוטה שלך נשמרה/)).toBeInTheDocument();
		expect(within(region).getByLabelText("שם הסוכן")).toHaveValue("My draft");
		expect(
			within(region).getByRole("button", { name: "שמירת הגדרות הסוכן" }),
		).toBeDisabled();
		expect(screen.getByText("worker-v2")).toBeInTheDocument();
		expect(within(region).getByText(/מושבת/)).toBeInTheDocument();
		fireEvent.click(
			within(region).getByRole("button", { name: "טעינת ההגדרות העדכניות" }),
		);
		expect(within(region).getByLabelText("מודל")).toHaveValue("someone-else");
		expect(
			within(region).getByRole("button", { name: "שמירת הגדרות הסוכן" }),
		).toBeEnabled();
	});
	it("shows loading and empty states without a fake connectivity claim", async () => {
		let resolve: (value: ContributionAgentSummary[]) => void = () => {};
		mocks.list.mockReturnValue(
			new Promise<ContributionAgentSummary[]>((done) => {
				resolve = done;
			}),
		);
		show();
		expect(screen.getByText("טוען סוכנים...")).toBeInTheDocument();
		resolve([]);
		expect(
			await screen.findByText(/עדיין לא נרשמו סוכנים/),
		).toBeInTheDocument();
	});
	it("keeps registration fields after failure and lets a failed registry read refresh", async () => {
		mocks.list.mockRejectedValueOnce(new Error("Registry unavailable"));
		mocks.install.mockRejectedValue(new Error("Install rejected"));
		show();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Registry unavailable",
		);
		fireEvent.click(screen.getByRole("button", { name: "רענון מצב" }));
		await card();
		const form = screen.getByRole("form", { name: "התקנת הגדרת סוכן" });
		fireEvent.change(within(form).getByLabelText("שם הסוכן"), {
			target: { value: "Retained draft" },
		});
		fireEvent.submit(form);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Install rejected",
		);
		expect(within(form).getByLabelText("שם הסוכן")).toHaveValue(
			"Retained draft",
		);
	});
});
