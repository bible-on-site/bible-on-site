import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearEntryDraft,
	clearLegacyEntryDraft,
	draftKey,
	entryDraftScope,
	LOCAL_DRAFT_VERSION,
	listNewEntryDrafts,
	newEntryDraftScope,
	readEntryDraft,
	readLegacyEntryDraft,
	type StoredEntryDraft,
	writeEntryDraft,
} from "~/lib/tanahpedia/local-draft";

const draft = (over: Partial<StoredEntryDraft> = {}): StoredEntryDraft => ({
	version: LOCAL_DRAFT_VERSION,
	accountId: "acct-1",
	scope: "entry:e1",
	sessionId: "tab-1",
	baseRevisionId: "rev-1",
	savedAt: "2026-01-25T10:00:00.000Z",
	form: { unique_name: "u", title: "t", content: "<p>c</p>" },
	source: "admin",
	notes: null,
	...over,
});

beforeEach(() => {
	localStorage.clear();
});

describe("draftKey scoping", () => {
	it("scopes keys by account and entry", () => {
		expect(draftKey("a1", entryDraftScope("e1"))).toBe(
			"tanahpedia-draft:v2:a1:entry:e1",
		);
		expect(draftKey("a1", newEntryDraftScope("x"))).toBe(
			"tanahpedia-draft:v2:a1:new:x",
		);
		// Two accounts can never collide on the same entry.
		expect(draftKey("a1", entryDraftScope("e1"))).not.toBe(
			draftKey("a2", entryDraftScope("e1")),
		);
	});
});

describe("writeEntryDraft / readEntryDraft", () => {
	it("round-trips a versioned draft", () => {
		const key = draftKey("a1", entryDraftScope("e1"));
		expect(writeEntryDraft(key, draft())).toBe(true);
		const result = readEntryDraft(key);
		expect(result).toEqual({ kind: "ok", draft: draft() });
	});

	it("returns none for a missing key", () => {
		expect(readEntryDraft("nope")).toEqual({ kind: "none" });
	});

	it("returns malformed for unparseable or wrong-version payloads", () => {
		localStorage.setItem("k1", "{broken");
		expect(readEntryDraft("k1")).toEqual({ kind: "malformed" });

		localStorage.setItem("k2", JSON.stringify({ version: 1, form: {} }));
		expect(readEntryDraft("k2")).toEqual({ kind: "malformed" });

		localStorage.setItem(
			"k3",
			JSON.stringify({ ...draft(), form: { title: 5 } }),
		);
		expect(readEntryDraft("k3")).toEqual({ kind: "malformed" });
	});

	it("returns false when storage is unavailable", () => {
		const spy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("QuotaExceededError");
			});
		try {
			expect(writeEntryDraft("k", draft())).toBe(false);
		} finally {
			spy.mockRestore();
		}
	});

	it("clears a stored draft", () => {
		writeEntryDraft("k", draft());
		clearEntryDraft("k");
		expect(readEntryDraft("k")).toEqual({ kind: "none" });
	});
});

describe("listNewEntryDrafts", () => {
	it("returns the account's new-entry drafts newest-first", () => {
		writeEntryDraft(
			draftKey("a1", "new:old"),
			draft({ scope: "new:old", savedAt: "2020-01-01T00:00:00.000Z" }),
		);
		writeEntryDraft(
			draftKey("a1", "new:late"),
			draft({ scope: "new:late", savedAt: "2026-01-01T00:00:00.000Z" }),
		);
		writeEntryDraft(draftKey("a1", "entry:e1"), draft());
		writeEntryDraft(
			draftKey("a2", "new:other"),
			draft({ accountId: "a2", scope: "new:other" }),
		);

		const drafts = listNewEntryDrafts("a1");
		expect(drafts.map((d) => d.scope)).toEqual(["new:late", "new:old"]);
	});

	it("skips malformed entries without failing the scan", () => {
		localStorage.setItem("tanahpedia-draft:v2:a1:new:bad", "{not a draft");
		writeEntryDraft(draftKey("a1", "new:good"), draft({ scope: "new:good" }));
		expect(listNewEntryDrafts("a1").map((d) => d.scope)).toEqual(["new:good"]);
	});
});

describe("legacy v1 stash", () => {
	it("reads and clears the unscoped #2611 stash", () => {
		localStorage.setItem(
			"tanahpedia-draft:e1",
			JSON.stringify({
				form: { unique_name: "u", title: "t", content: "c" },
				savedAt: "2026-01-25T10:00:00.000Z",
			}),
		);
		const legacy = readLegacyEntryDraft("e1");
		expect(legacy?.form.title).toBe("t");
		expect(legacy?.baseRevisionId).toBeNull();
		clearLegacyEntryDraft("e1");
		expect(readLegacyEntryDraft("e1")).toBeNull();
	});

	it("ignores unrelated keys", () => {
		expect(readLegacyEntryDraft("missing")).toBeNull();
	});
});
