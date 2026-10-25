import { describe, expect, it } from "vitest";
import { classifySaveError } from "~/lib/server-fn-errors";

describe("classifySaveError", () => {
	it("classifies the session marker as a session failure", () => {
		const result = classifySaveError(
			new Error("SESSION_EXPIRED: admin session expired"),
		);
		expect(result.kind).toBe("session");
		expect(result.message).toContain("התחבר");
	});

	it("classifies TypeError fetch rejections as network failures", () => {
		const result = classifySaveError(new TypeError("Failed to fetch"));
		expect(result.kind).toBe("network");
		expect(result.message).toContain("חיבור");
	});

	it("classifies fetch-shaped network messages", () => {
		expect(
			classifySaveError(new Error("NetworkError when attempting")).kind,
		).toBe("network");
		expect(
			classifySaveError(new Error("net::ERR_NAME_NOT_RESOLVED")).kind,
		).toBe("network");
	});

	it("classifies VALIDATION errors and keeps the server detail", () => {
		const result = classifySaveError(
			new Error("VALIDATION: השם הייחודי כבר תפוס על ידי ערך אחר"),
		);
		expect(result.kind).toBe("validation");
		expect(result.message).toContain("השם הייחודי כבר תפוס");
	});

	it("falls back to a generic server failure", () => {
		const result = classifySaveError(
			new Error("Table 'tanahpedia_entry_revision' doesn't exist"),
		);
		expect(result.kind).toBe("server");
		expect(result.message).toContain("שגיאת שרת");
	});

	it("preserves the raw message as detail", () => {
		const raw = new Error("raw boom");
		expect(classifySaveError(raw).detail).toBe("raw boom");
	});
});
