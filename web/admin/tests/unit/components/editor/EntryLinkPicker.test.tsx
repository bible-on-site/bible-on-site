import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type EntryLinkOption,
	EntryLinkPicker,
} from "~/components/editor/EntryLinkPicker";

const ENTRIES: EntryLinkOption[] = [
	{ id: "1", title: "משה רבנו", uniqueName: "משה" },
	{ id: "2", title: "יהושע בן נון", uniqueName: "יהושע" },
];

function renderPicker(
	overrides: Partial<{
		search: (q: string) => Promise<EntryLinkOption[]>;
		onSelect: (entry: EntryLinkOption) => void;
		selectedUniqueName: string;
	}> = {},
) {
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
			renderPicker({
				search: vi.fn(async () => Promise.reject(new Error("x"))),
			});
			expect(
				await screen.findByText("טעינת רשימת הערכים נכשלה."),
			).toBeInTheDocument();
		});
	});

	describe("when a newer query is already in flight", () => {
		it("drops a stale resolve instead of overwriting the fresh results", async () => {
			let resolveFirst: ((v: EntryLinkOption[]) => void) | undefined;
			const search = vi.fn((q: string) => {
				if (q === "") {
					return new Promise<EntryLinkOption[]>((resolve) => {
						resolveFirst = resolve;
					});
				}
				return Promise.resolve(ENTRIES);
			});
			renderPicker({ search });
			await waitFor(() => expect(search).toHaveBeenCalledWith(""));

			fireEvent.change(screen.getByRole("searchbox"), {
				target: { value: "י" },
			});
			expect(await screen.findByText("משה רבנו")).toBeInTheDocument();

			resolveFirst?.([{ id: "stale", title: "ישן", uniqueName: "ישן" }]);
			await act(async () => {
				await Promise.resolve();
			});

			expect(screen.queryByText("ישן")).not.toBeInTheDocument();
			expect(screen.getByText("משה רבנו")).toBeInTheDocument();
		});

		it("drops a stale rejection instead of flagging an error", async () => {
			let rejectFirst: ((reason: unknown) => void) | undefined;
			const search = vi.fn((q: string) => {
				if (q === "") {
					return new Promise<EntryLinkOption[]>((_, reject) => {
						rejectFirst = reject;
					});
				}
				return Promise.resolve(ENTRIES);
			});
			renderPicker({ search });
			await waitFor(() => expect(search).toHaveBeenCalledWith(""));

			fireEvent.change(screen.getByRole("searchbox"), {
				target: { value: "י" },
			});
			expect(await screen.findByText("משה רבנו")).toBeInTheDocument();

			rejectFirst?.(new Error("stale failure"));
			await act(async () => {
				await Promise.resolve();
			});

			expect(
				screen.queryByText("טעינת רשימת הערכים נכשלה."),
			).not.toBeInTheDocument();
		});
	});

	describe("when the result list overflows", () => {
		it("notes how many entries are hidden", async () => {
			const many = Array.from({ length: 25 }, (_, i) => ({
				id: `e${i}`,
				title: `ערך ${i}`,
				uniqueName: `entry-${i}`,
			}));
			renderPicker({ search: vi.fn(async () => many) });
			expect(await screen.findByText(/מוצגים 20 מתוך 25/)).toBeInTheDocument();
		});
	});

	describe("when an entry is already linked", () => {
		it("highlights it in the list", async () => {
			renderPicker({ selectedUniqueName: "יהושע" });
			const button = (await screen.findByText("יהושע בן נון")).closest(
				"button",
			);
			expect(button).toHaveClass("bg-blue-50");
			expect(button).toHaveClass("font-medium");
		});
	});

	describe("when nothing matches", () => {
		it("says so", async () => {
			renderPicker({ search: vi.fn(async () => []) });
			expect(await screen.findByText("לא נמצאו ערכים.")).toBeInTheDocument();
		});
	});
});
