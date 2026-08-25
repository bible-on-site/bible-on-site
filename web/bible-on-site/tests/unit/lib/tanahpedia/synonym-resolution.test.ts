import {
	entryHref,
	resolveSynonymSlug,
} from "@/lib/tanahpedia/synonym-resolution";
import type { SynonymTarget } from "@/lib/tanahpedia/types";

jest.mock("@/lib/tanahpedia/service", () => ({
	getEntriesBySynonym: jest.fn(),
}));

const { getEntriesBySynonym } = jest.requireMock(
	"@/lib/tanahpedia/service",
) as {
	getEntriesBySynonym: jest.Mock;
};

function target(overrides: Partial<SynonymTarget> = {}): SynonymTarget {
	return {
		entryId: "1",
		uniqueName: "משה-רבנו",
		title: "משה רבנו",
		label: null,
		...overrides,
	};
}

describe("resolveSynonymSlug", () => {
	beforeEach(() => {
		getEntriesBySynonym.mockReset();
	});

	describe("when the name matches a single entry", () => {
		it("resolves to that entry as an alias", async () => {
			getEntriesBySynonym.mockResolvedValue([target()]);

			await expect(resolveSynonymSlug("משה")).resolves.toEqual({
				kind: "alias",
				target: target(),
			});
		});
	});

	describe("when the name matches several entries", () => {
		it("resolves to a disambiguation with every target", async () => {
			const targets = [
				target({ entryId: "1", label: "מנהיג ישראל" }),
				target({ entryId: "2", uniqueName: "משה-אחר", title: "משה אחר" }),
			];
			getEntriesBySynonym.mockResolvedValue(targets);

			await expect(resolveSynonymSlug("משה")).resolves.toEqual({
				kind: "disambiguation",
				targets,
			});
		});
	});

	describe("when the name matches nothing", () => {
		it("resolves to missing", async () => {
			getEntriesBySynonym.mockResolvedValue([]);

			await expect(resolveSynonymSlug("אין-כזה")).resolves.toEqual({
				kind: "missing",
			});
		});
	});

	describe("when the lookup fails", () => {
		it("resolves to missing instead of throwing", async () => {
			getEntriesBySynonym.mockRejectedValue(new Error("db down"));

			await expect(resolveSynonymSlug("משה")).resolves.toEqual({
				kind: "missing",
			});
		});
	});
});

describe("entryHref", () => {
	it("encodes the hebrew unique name", () => {
		expect(entryHref("משה-רבנו")).toBe(
			"/pedia/%D7%9E%D7%A9%D7%94-%D7%A8%D7%91%D7%A0%D7%95",
		);
	});
});
