import { describe, expect, it } from "vitest";
import {
	isRevisionConflictError,
	normalizeRevisionSource,
	REVISION_CONFLICT_PREFIX,
	REVISION_SQUASH_WINDOW_SECONDS,
	REVISION_SOURCE_ADMIN,
	REVISION_SOURCE_LLM,
	RevisionConflictError,
	shouldSquashIntoHead,
} from "~/lib/tanahpedia/revisions-shared";

describe("shouldSquashIntoHead", () => {
	it("returns true when the head is fresh and from the same source", () => {
		expect(
			shouldSquashIntoHead({ source: "admin", ageSeconds: 30 }, "admin"),
		).toBe(true);
	});

	it("returns false when the head is from a different source", () => {
		expect(
			shouldSquashIntoHead(
				{ source: "llm-assistant", ageSeconds: 30 },
				"admin",
			),
		).toBe(false);
	});

	it("returns false when the head is older than the window", () => {
		expect(
			shouldSquashIntoHead(
				{ source: "admin", ageSeconds: REVISION_SQUASH_WINDOW_SECONDS + 1 },
				"admin",
			),
		).toBe(false);
	});

	it("returns false when there is no head", () => {
		expect(shouldSquashIntoHead(null, "admin")).toBe(false);
	});
});

describe("normalizeRevisionSource", () => {
	it("defaults to admin for missing or blank sources", () => {
		expect(normalizeRevisionSource(undefined)).toBe(REVISION_SOURCE_ADMIN);
		expect(normalizeRevisionSource("  ")).toBe(REVISION_SOURCE_ADMIN);
	});

	it("trims and preserves an explicit source", () => {
		expect(normalizeRevisionSource(` ${REVISION_SOURCE_LLM} `)).toBe(
			REVISION_SOURCE_LLM,
		);
	});
});

describe("isRevisionConflictError", () => {
	it("detects the conflict prefix on errors", () => {
		const err = new RevisionConflictError("stale base");
		expect(err.message.startsWith(REVISION_CONFLICT_PREFIX)).toBe(true);
		expect(isRevisionConflictError(err)).toBe(true);
		expect(
			isRevisionConflictError(
				new Error(`${REVISION_CONFLICT_PREFIX} moved head`),
			),
		).toBe(true);
	});

	it("returns false for unrelated errors and non-errors", () => {
		expect(isRevisionConflictError(new Error("boom"))).toBe(false);
		expect(isRevisionConflictError("boom")).toBe(false);
		expect(isRevisionConflictError(null)).toBe(false);
	});
});
