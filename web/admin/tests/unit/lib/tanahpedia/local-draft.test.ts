import { beforeEach, describe, expect, it } from "vitest";
import {
	clearEntryDraft,
	readEntryDraft,
	stashEntryDraft,
} from "~/lib/tanahpedia/local-draft";

describe("tanahpedia entry draft stash", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("round-trips a stashed draft under the entry key", () => {
		const form = {
			unique_name: "שם",
			title: "כותרת",
			content: "<p>גוף</p>",
		};
		stashEntryDraft("entry-1", form, "rev-1");

		const draft = readEntryDraft("entry-1");
		expect(draft?.form).toEqual(form);
		expect(draft?.baseRevisionId).toBe("rev-1");
		expect(draft?.savedAt).toEqual(expect.any(String));
	});

	it("returns null when nothing is stashed", () => {
		expect(readEntryDraft("entry-1")).toBeNull();
	});

	it("returns null for malformed stored JSON", () => {
		localStorage.setItem("tanahpedia-draft:entry-1", "{not-json");
		expect(readEntryDraft("entry-1")).toBeNull();
	});

	it("returns null for a structurally invalid payload", () => {
		localStorage.setItem(
			"tanahpedia-draft:entry-1",
			JSON.stringify({ form: { title: 42 } }),
		);
		expect(readEntryDraft("entry-1")).toBeNull();
	});

	it("treats a missing baseRevisionId as stale (null)", () => {
		localStorage.setItem(
			"tanahpedia-draft:entry-1",
			JSON.stringify({
				form: { unique_name: "שם", title: "כותרת", content: "" },
				savedAt: "2026-01-01",
			}),
		);
		expect(readEntryDraft("entry-1")?.baseRevisionId).toBeNull();
	});

	it("clears the stash", () => {
		stashEntryDraft(
			"entry-1",
			{ unique_name: "", title: "כ", content: "" },
			null,
		);
		clearEntryDraft("entry-1");
		expect(readEntryDraft("entry-1")).toBeNull();
	});
});
