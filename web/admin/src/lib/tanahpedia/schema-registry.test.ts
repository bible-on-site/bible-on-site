import { describe, expect, it } from "vitest";
import { getTanahpediaSchemaSummaryForLlm } from "./schema-registry";

describe("getTanahpediaSchemaSummaryForLlm", () => {
	it("includes core tables and LLM safety rule", () => {
		const s = getTanahpediaSchemaSummaryForLlm();
		expect(s).toContain("tanahpedia_entity");
		expect(s).toContain("tanahpedia_person_name");
		expect(s).toContain("tanahpedia_place_identification");
		expect(s).toContain("MAIN");
		expect(s).toContain("LLM must NOT assume direct DB writes");
	});
});
