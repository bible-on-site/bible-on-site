import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkPediaNameMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/tanahpedia/aliases", () => ({
	checkPediaName: checkPediaNameMock,
}));

import { MainAddressSection } from "~/components/tanahpedia/MainAddressSection";

const BASE = "http://localhost:3001";

type SectionProps = Parameters<typeof MainAddressSection>[0];

// Controlled input: mirror the parent's state so blur sees typed input.
function Harness({
	initialValue,
	...props
}: Omit<SectionProps, "value"> & { initialValue: string }) {
	const [value, setValue] = useState(initialValue);
	return (
		<MainAddressSection
			{...props}
			value={value}
			onValueChange={(v) => {
				setValue(v);
				props.onValueChange(v);
			}}
		/>
	);
}

function renderSection(over: Partial<SectionProps> = {}) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const props = {
		entryId: "entry-1",
		savedUniqueName: "משה-רבנו",
		onValueChange: vi.fn(),
		websiteBase: BASE,
		keepOldAsAlias: true,
		onKeepOldAsAliasChange: vi.fn(),
		...over,
	} as Omit<SectionProps, "value">;

	render(
		<QueryClientProvider client={client}>
			<Harness
				{...props}
				initialValue={"value" in over ? (over.value as string) : "משה-רבנו"}
			/>
		</QueryClientProvider>,
	);
	return props;
}

describe("MainAddressSection", () => {
	beforeEach(() => {
		checkPediaNameMock
			.mockReset()
			.mockResolvedValue({
				kind: "self-main",
				name: "משה-רבנו",
				aliasTargets: [],
			});
	});

	it("shows the full public URL with copy and open actions", () => {
		renderSection();

		const link = screen.getByRole("link", { name: /localhost:3001\/pedia\// });
		expect(link).toHaveAttribute(
			"href",
			`${BASE}/pedia/${encodeURIComponent("משה-רבנו")}`,
		);
		expect(
			screen.getByRole("button", { name: "העתק קישור" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "פתח תצוגה" })).toBeInTheDocument();
	});

	it("explains that the title is display text and the id is not a URL part", () => {
		renderSection();

		expect(screen.getByText(/הכותרת היא טקסט התצוגה/)).toBeInTheDocument();
		expect(screen.getByText(/מזהה הערך הפנימי אינו חלק/)).toBeInTheDocument();
	});

	it("parses a pasted full URL down to its last segment on blur", () => {
		const props = renderSection({ value: "" });
		const input = screen.getByLabelText(/שם ייחודי/);

		fireEvent.change(input, {
			target: { value: `${BASE}/pedia/%D7%9E%D7%A9%D7%94` },
		});
		fireEvent.blur(input);

		expect(props.onValueChange).toHaveBeenLastCalledWith("משה");
	});

	it("warns when the name is already another entry's alias", async () => {
		checkPediaNameMock.mockResolvedValue({
			kind: "alias",
			name: "משה",
			targets: [
				{
					entryId: "e-b",
					uniqueName: "משה-אחר",
					title: "משה אחר",
					label: null,
				},
			],
		});
		renderSection({ value: "משה" });

		expect(
			await screen.findByText(/משמש היום ככתובת נוספת/),
		).toBeInTheDocument();
	});

	it("rejects a name taken by another entry's main URL", async () => {
		checkPediaNameMock.mockResolvedValue({
			kind: "canonical",
			name: "משה",
			entry: { id: "e-b", uniqueName: "משה", title: "משה אחר" },
			aliasTargets: [],
		});
		renderSection({ value: "משה" });

		expect(
			await screen.findByText(/תפוס על ידי הערך «משה אחר»/),
		).toBeInTheDocument();
	});

	it("rejects a reserved category slug", async () => {
		checkPediaNameMock.mockResolvedValue({
			kind: "reserved",
			name: "אישים",
			categoryLabel: "אישים",
		});
		renderSection({ value: "אישים" });

		expect(await screen.findByText(/שמור לנתיב הקטגוריה/)).toBeInTheDocument();
	});

	it("shows the rename transition and the keep-old-as-alias option", async () => {
		checkPediaNameMock.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה-רבנו"
					? { kind: "self-main", name: "משה-רבנו", aliasTargets: [] }
					: { kind: "free", name: data.name },
		);
		renderSection({ value: "משה-הנביא" });

		expect(await screen.findByText(/שינוי כתובת/)).toBeInTheDocument();
		const checkbox = screen.getByRole("checkbox");
		expect(checkbox).toBeChecked();
		expect(
			screen.getByText(/שמור את הכתובת הקודמת כשם חלופי/),
		).toBeInTheDocument();
	});

	it("lets the user opt out of keeping the old address", async () => {
		checkPediaNameMock.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה-רבנו"
					? { kind: "self-main", name: "משה-רבנו", aliasTargets: [] }
					: { kind: "free", name: data.name },
		);
		const props = renderSection({ value: "משה-הנביא" });

		fireEvent.click(await screen.findByRole("checkbox"));

		expect(props.onKeepOldAsAliasChange).toHaveBeenCalledWith(false);
	});

	it("explains a shared old name instead of offering the checkbox", async () => {
		checkPediaNameMock.mockImplementation(
			async ({ data }: { data: { name: string } }) =>
				data.name === "משה-רבנו"
					? {
							kind: "self-main",
							name: "משה-רבנו",
							aliasTargets: [
								{
									entryId: "entry-1",
									uniqueName: "משה-רבנו",
									title: "משה רבנו",
									label: "הנביא",
								},
								{
									entryId: "e-b",
									uniqueName: "משה-אחר",
									title: "משה אחר",
									label: "אחר",
								},
							],
						}
					: { kind: "free", name: data.name },
		);
		renderSection({ value: "משה-הנביא" });

		expect(
			await screen.findByText(/משותף גם עם «משה אחר»/),
		).toBeInTheDocument();
		expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
	});

	it("checks the name against the server once the debounce settles", async () => {
		renderSection({ value: "משה-הנביא" });

		await waitFor(() =>
			expect(checkPediaNameMock).toHaveBeenCalledWith({
				data: { name: "משה-הנביא", forEntryId: "entry-1" },
			}),
		);
	});
});
