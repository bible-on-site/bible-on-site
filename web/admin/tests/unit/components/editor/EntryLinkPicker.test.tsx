import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	EntryLinkPicker,
	type EntryLinkOption,
} from "~/components/editor/EntryLinkPicker";

const ENTRIES: EntryLinkOption[] = [
	{ id: "1", title: "משה רבנו", uniqueName: "משה" },
	{ id: "2", title: "יהושע בן נון", uniqueName: "יהושע" },
];

function renderPicker(overrides: Partial<{
	search: (q: string) => Promise<EntryLinkOption[]>;
	onSelect: (entry: EntryLinkOption) => void;
	selectedUniqueName: string;
}> = {}) {
	const search = overrides.search ?? vi.fn(async () => ENTRIES);
	const onSelect = overrides.onSelect ?? vi.fn();
	render(
		<EntryLinkPicker
			search={search}
			onSelect={onSelect}
			selectedUniqueName={overrides.selectedUniqueName}
		/>,
	);
	return { search, onSelect };
}

describe("EntryLinkPicker", () => {
	describe("when it mounts", () => {
		it("lists the entries returned by the search", async () => {
			renderPicker();
			expect(await screen.findByText("משה רבנו")).toBeInTheDocument();
			expect(screen.getByText("יהושע בן נון")).toBeInTheDocument();
		});

		it("queries with an empty string so the full list shows", async () => {
			const { search } = renderPicker();
			await waitFor(() => expect(search).toHaveBeenCalledWith(""));
		});
	});

	describe("when the user types", () => {
		it("searches for the typed text", async () => {
			const search = vi.fn(async () => ENTRIES);
			renderPicker({ search });
			fireEvent.change(screen.getByRole("searchbox"), {
				target: { value: "יהו" },
			});
			await waitFor(() => expect(search).toHaveBeenCalledWith("יהו"));
		});
	});

	describe("when an entry is clicked", () => {
		it("reports the chosen entry", async () => {
			const onSelect = vi.fn();
			renderPicker({ onSelect });
			fireEvent.click(await screen.findByText("משה רבנו"));
			expect(onSelect).toHaveBeenCalledWith(ENTRIES[0]);
		});
	});

	describe("when the search fails", () => {
		it("shows an error instead of an empty list", async () => {
			renderPicker({ search: vi.fn(async () => Promise.reject(new Error("x"))) });
			expect(await screen.findByText("טעינת רשימת הערכים נכשלה.")).toBeInTheDocument();
		});
	});

	describe("when nothing matches", () => {
		it("says so", async () => {
			renderPicker({ search: vi.fn(async () => []) });
			expect(await screen.findByText("לא נמצאו ערכים.")).toBeInTheDocument();
		});
	});
});
