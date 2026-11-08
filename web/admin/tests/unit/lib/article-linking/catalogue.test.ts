import { describe, expect, it } from "vitest";
import {
	cataloguePasukLabel,
	cataloguePerekLabel,
	resolvePerekRef,
	type TargetCatalogue,
} from "~/lib/article-linking/catalogue";
import {
	LINK_PROPOSAL_ACTIONS,
	LINK_PROPOSAL_STATUSES,
} from "~/lib/article-linking/types";
import { catalogue } from "./fixture";

describe("resolvePerekRef", () => {
	it("reports ambiguous when two rows share the coordinate", () => {
		const duplicated: TargetCatalogue = {
			perakim: [
				{
					id: 1,
					seferName: "בראשית",
					additionalLetter: null,
					perekInContext: 1,
					pasukCount: 31,
				},
				{
					id: 2,
					seferName: "בראשית",
					additionalLetter: null,
					perekInContext: 1,
					pasukCount: 31,
				},
			],
			authors: [],
			dedications: [],
		};
		const out = resolvePerekRef(duplicated, {
			sefer: "בראשית",
			additional: null,
			perek: 1,
			pasuk: null,
		});
		expect(out.kind).toBe("ambiguous");
	});

	it("resolves an additional-letter sefer through the letter", () => {
		const out = resolvePerekRef(catalogue, {
			sefer: "שמואל",
			additional: "ב",
			perek: 5,
			pasuk: 7,
		});
		expect(out.kind).toBe("resolved");
	});

	it("reports not-found for an unknown sefer", () => {
		expect(
			resolvePerekRef(catalogue, {
				sefer: "ספר בדיקה",
				additional: null,
				perek: 1,
				pasuk: null,
			}).kind,
		).toBe("not-found");
	});

	it("reports ambiguous for an additional sefer without the letter", () => {
		expect(
			resolvePerekRef(catalogue, {
				sefer: "שמואל",
				additional: null,
				perek: 5,
				pasuk: null,
			}).kind,
		).toBe("ambiguous");
	});

	it("inherits the alias's additional letter when the citation omits it", () => {
		const out = resolvePerekRef(catalogue, {
			sefer: "עזרא",
			additional: null,
			perek: 7,
			pasuk: null,
		});
		expect(out.kind).toBe("resolved");
		if (out.kind === "resolved") expect(out.perek.id).toBe(800);
	});
});

describe("catalogue labels", () => {
	it("labels a perek and a pasuk", () => {
		const perek = catalogue.perakim[0];
		expect(cataloguePerekLabel(perek)).toContain("בראשית");
		expect(cataloguePasukLabel(perek, 1)).toContain("א");
	});
});

describe("proposal lifecycle constants", () => {
	it("pins the status and action vocabulary", () => {
		expect(LINK_PROPOSAL_STATUSES).toEqual([
			"pending",
			"held",
			"approved",
			"rejected",
			"applied",
			"stale",
		]);
		expect(LINK_PROPOSAL_ACTIONS).toEqual([
			"add",
			"remove",
			"replace",
			"clear",
		]);
	});
});
