/**
 * @jest-environment jsdom
 *
 * Marker rendering coverage for the aliyah boundary layer in
 * UnitTextBody (issues #2519/#3165): every applicable division layer
 * renders inline at exact boundary starts — coincident boundaries that
 * agree on the ordinal merge into one shared pill whose detail keeps
 * each constituent layer, divergent communities keep their own tagged
 * markers, the URL-selected layer emphasizes without hiding the rest,
 * perek labels stay modest alongside them, and the legacy path stays
 * unchanged when no markers are passed.
 */
import { render } from "@testing-library/react";
import {
	type UnitBoundaryMarker,
	UnitTextBody,
} from "../../../src/app/components/reading/UnitTextBody";
import { getUnitAliyahMarkers } from "../../../src/data/parasha/parasha-aliyot";
import {
	getAllParashaUnits,
	getParashaUnitById,
} from "../../../src/data/parasha/parasha-units";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import { canonicalPasukCount } from "../../../src/lib/reading/queries";

function must<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a value");
	return value;
}

const units = getAllParashaUnits();
const bereshit = units[0];
const layer = getUnitAliyahMarkers(bereshit.unitId);
const markers = new Map(Object.entries(layer.markers));

function renderBody(props: Partial<Parameters<typeof UnitTextBody>[0]> = {}) {
	return render(
		<UnitTextBody
			ranges={getParashaUnitById(bereshit.unitId).ranges}
			entityRefsByPerek={{}}
			pasukCount={canonicalPasukCount}
			resolvePerek={(perekId) => {
				const perek = getPerekByPerekId(perekId);
				return { pesukim: perek.pesukim, source: perek.source };
			}}
			{...props}
		/>,
	);
}

/** Each cluster marker's ordinal label, in DOM order. */
const clusterOrdinals = (pasuk: Element | null | undefined) =>
	Array.from(pasuk?.querySelectorAll("[data-aliyah-marker]") ?? []).map(
		(el) => el.querySelector(".aliyahMarkerOrdinal")?.textContent,
	);

describe("aliyah boundary markers", () => {
	it("renders a marker at every boundary's exact start pasuk", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// The Shabbat layer's seven aliyot + maftir all render — every
		// marker stays visible regardless of layer (issue #3165), merged
		// or not (`~=` matches a constituent key inside a merged key).
		const shabbatMarkers = Array.from(
			container.querySelectorAll('[data-aliyah-key~="Bereshit:shabbat"]'),
		);
		expect(shabbatMarkers).toHaveLength(8);
		for (const el of shabbatMarkers) {
			expect(el.hasAttribute("hidden")).toBe(false);
		}
		expect(
			shabbatMarkers.map(
				(el) => el.querySelector(".aliyahMarkerOrdinal")?.textContent,
			),
		).toEqual([
			"ראשון",
			"שני",
			"שלישי",
			"רביעי",
			"חמישי",
			"שישי",
			"שביעי",
			"מפטיר",
		]);
	});

	it("shows every applicable layer together — none hidden", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// Weekday markers render beside Shabbat's — their own marker at
		// weekday-only coordinates and inside the merged start pill;
		// the replaced single-layer switch left no hidden layer behind.
		const weekdayMarkers = container.querySelectorAll(
			'[data-aliyah-key~="Bereshit:weekday"]',
		);
		expect(weekdayMarkers.length).toBe(3);
		for (const el of weekdayMarkers) {
			expect(el.hasAttribute("hidden")).toBe(false);
		}
		expect(
			container.querySelectorAll("[data-aliyah-marker][hidden]"),
		).toHaveLength(0);
	});

	it("merges coincident agreeing boundaries into one marker", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// בראשית א א opens the unit under all three agreeing layers —
		// base Shabbat, its hebcal variant, and weekday — merged into a
		// single shared pill (issue #3165 review): one decoration for
		// the common boundary, not three indistinguishable ראשוןs.
		const first = must(container.querySelector("#pasuk-1-1"));
		const merged = first.querySelectorAll("[data-aliyah-marker]");
		expect(merged).toHaveLength(1);
		expect(merged[0].getAttribute("data-aliyah-key")).toBe(
			"Bereshit:shabbat Bereshit:shabbat:alt-hebcal Bereshit:weekday",
		);
		expect(merged[0].getAttribute("data-aliyah-category")).toBe("shared");
		expect(clusterOrdinals(first)).toEqual(["ראשון"]);
		// The visible tag lists the shared schemes; the agreeing variant
		// community folds in without a name of its own.
		expect(first.querySelector(".aliyahMarkerTag")?.textContent).toBe(
			"שבת+חול",
		);
		// Every merged layer keeps its full detail — the accessible name
		// enumerates each division sharing the boundary.
		const ariaLabel = merged[0].getAttribute("aria-label") ?? "";
		expect(ariaLabel).toContain("קריאת שבת");
		expect(ariaLabel).toContain("קריאת חול");
		expect(ariaLabel).toContain("חלוקה אחרת");
		expect(ariaLabel).toContain("עלייה ראשונה");
	});

	it("keeps a divergent community's own tagged marker", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// The alt-hebcal re-slicing moves שישי from ד כג to ה א — both
		// boundaries render at their own coordinates, the base's as a
		// standalone pill and the community's with its variant tag.
		const base = must(
			container
				.querySelector("#pasuk-4-23")
				?.querySelector('[data-aliyah-key="Bereshit:shabbat"]'),
		);
		expect(base.textContent).toContain("שישי");
		expect(base.getAttribute("data-aliyah-category")).toBe("shabbat");
		const variant = must(
			container
				.querySelector("#pasuk-5-1")
				?.querySelector('[data-aliyah-key="Bereshit:shabbat:alt-hebcal"]'),
		);
		expect(variant.textContent).toContain("שישי");
		expect(variant.textContent).toContain("חלוקה אחרת");
		expect(variant.getAttribute("data-aliyah-category")).toBe("variant");
	});

	it("tags each marker with its layer and exposes richer detail", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// ד כג: the variant moved its שישי elsewhere, so the base marker
		// stands alone — a single-layer pill keeps its own styling.
		const shabbat6 = must(
			container
				.querySelector("#pasuk-4-23")
				?.querySelector('[data-aliyah-key="Bereshit:shabbat"]'),
		);
		expect(shabbat6.tagName).toBe("BUTTON");
		expect(shabbat6.getAttribute("data-aliyah-category")).toBe("shabbat");
		expect(shabbat6.getAttribute("aria-label")).toBe(
			"פרשת בראשית · קריאת שבת · עלייה שישית (בראשית ד כג - ה כד)",
		);
		// Tag + ordinal stay visible without hover; the detail bubble is
		// the CSS-revealed richer layer and is hidden from AT (the
		// button's aria-label already carries it).
		expect(shabbat6.textContent).toContain("שבת");
		expect(shabbat6.textContent).toContain("שישי");
		const detail = shabbat6.querySelector(".aliyahMarkerDetail");
		expect(detail?.getAttribute("aria-hidden")).toBe("true");

		const variant6 = container
			.querySelector("#pasuk-5-1")
			?.querySelector('[data-aliyah-key="Bereshit:shabbat:alt-hebcal"]');
		expect(variant6?.getAttribute("data-aliyah-category")).toBe("variant");
		expect(variant6?.getAttribute("aria-label")).toBe(
			"פרשת בראשית · קריאת שבת · חלוקה אחרת · עלייה שישית (בראשית ה א-כד)",
		);
	});

	it("places each marker inside the boundary pasuk's own span", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// שני begins at בראשית ב ד — the marker sits inside the pasuk-2-4
		// span (merged with the agreeing variant there).
		const pasuk = container.querySelector("#pasuk-2-4");
		const marker = pasuk?.querySelector(
			'[data-aliyah-key~="Bereshit:shabbat"]',
		);
		expect(marker?.textContent).toContain("שני");
		// מפטיר re-reads the tail: marker inside pasuk-6-5.
		const maftir = container
			.querySelector("#pasuk-6-5")
			?.querySelector('[data-aliyah-key~="Bereshit:shabbat"]');
		expect(maftir?.textContent).toContain("מפטיר");
		expect(maftir?.getAttribute("data-aliyah-role")).toBe("maftir");
		expect(maftir?.getAttribute("aria-label")).toContain("מפטיר");
	});

	it("emphasizes only the selected layer's markers", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		const emphasized = container.querySelectorAll("[data-aliyah-selected]");
		// Eight Shabbat boundaries — merged pills count once since they
		// contain the selected key among their constituents.
		expect(emphasized.length).toBe(8);
		for (const el of emphasized) {
			expect(el.getAttribute("data-aliyah-key")?.split(" ")).toContain(
				"Bereshit:shabbat",
			);
		}
	});

	it("emphasizes a merged marker for any constituent layer", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: "Bereshit:weekday",
		});
		const emphasized = Array.from(
			container.querySelectorAll("[data-aliyah-selected]"),
		).map((el) => el.getAttribute("data-aliyah-key"));
		// The merged start pill plus weekday's two own boundaries.
		expect(emphasized).toHaveLength(3);
		expect(emphasized[0]).toBe(
			"Bereshit:shabbat Bereshit:shabbat:alt-hebcal Bereshit:weekday",
		);
		expect(emphasized.slice(1)).toEqual([
			"Bereshit:weekday",
			"Bereshit:weekday",
		]);
	});

	it("renders no emphasis without an emphasis key", () => {
		const { container } = renderBody({ boundaryMarkers: markers });
		expect(container.querySelectorAll("[data-aliyah-selected]")).toHaveLength(
			0,
		);
		expect(
			container.querySelectorAll("[data-aliyah-marker]").length,
		).toBeGreaterThan(0);
	});

	it("keeps the common category when coincident layers share one", () => {
		// Two custom divisions agreeing at one coordinate — both variant
		// category — share a pill that keeps variant styling and lists
		// every community's tag (the all-variant group has no non-variant
		// tag source to prefer).
		const { container } = renderBody({
			boundaryMarkers: new Map<string, UnitBoundaryMarker[]>([
				[
					"1:5",
					[
						{
							key: 'vayigash:shabbat:חב"ד',
							label: "שני",
							category: "variant",
							tag: 'חב"ד',
						},
						{
							key: "vayigash:shabbat:אשכנז",
							label: "שני",
							category: "variant",
							tag: "אשכנז",
						},
					],
				],
			]),
		});
		const marker = must(
			container.querySelector("#pasuk-1-5 [data-aliyah-marker]"),
		);
		expect(
			container.querySelectorAll("#pasuk-1-5 [data-aliyah-marker]"),
		).toHaveLength(1);
		expect(marker.getAttribute("data-aliyah-key")).toBe(
			'vayigash:shabbat:חב"ד vayigash:shabbat:אשכנז',
		);
		expect(marker.getAttribute("data-aliyah-category")).toBe("variant");
		expect(marker.querySelector(".aliyahMarkerTag")?.textContent).toBe(
			'חב"ד+אשכנז',
		);
		// No detail provided — the fallback composes tag + ordinal per layer.
		expect(marker.getAttribute("aria-label")).toBe('חב"ד שני\nאשכנז שני');
	});

	it("merges an untagged layer into the shared pill", () => {
		// A layer without a tag contributes its key and detail line but
		// adds no tag text — the pill shows only the tagged layers' names.
		const { container } = renderBody({
			boundaryMarkers: new Map<string, UnitBoundaryMarker[]>([
				[
					"1:7",
					[
						{ key: "x:shabbat", label: "שלישי", category: "shabbat" },
						{
							key: "x:weekday",
							label: "שלישי",
							category: "weekday",
							tag: "חול",
						},
					],
				],
			]),
		});
		const marker = must(
			container.querySelector("#pasuk-1-7 [data-aliyah-marker]"),
		);
		expect(marker.querySelector(".aliyahMarkerTag")?.textContent).toBe("חול");
		expect(marker.getAttribute("aria-label")).toBe("שלישי\nחול שלישי");
	});

	it("demotes perek-break labels while markers are present", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		expect(container.querySelector(".perekBreakLabelModest")).not.toBeNull();
		expect(container.querySelector(".perekBreakLabel")).toBeNull();
	});

	it("renders coincident aliyah/perek boundaries without collision", () => {
		// ויקרא א opens פרשת ויקרא AND starts a perek — both labels appear.
		const vayikra = must(units.find((u) => u.heading === "ויקרא"));
		const vLayer = getUnitAliyahMarkers(vayikra.unitId);
		const { container } = render(
			<UnitTextBody
				ranges={getParashaUnitById(vayikra.unitId).ranges}
				entityRefsByPerek={{}}
				pasukCount={canonicalPasukCount}
				resolvePerek={(perekId) => {
					const perek = getPerekByPerekId(perekId);
					return { pesukim: perek.pesukim, source: perek.source };
				}}
				boundaryMarkers={new Map(Object.entries(vLayer.markers))}
				emphasisMarkerKey={vLayer.defaultKey}
			/>,
		);
		const firstPasuk = container.querySelector("#pasuk-91-1");
		expect(
			firstPasuk?.querySelector('[data-aliyah-key~="Vayikra:shabbat"]')
				?.textContent,
		).toContain("ראשון");
		// The modest perek label for ויקרא א renders just before it.
		expect(container.textContent).toContain("ויקרא א");
		expect(container.querySelector(".perekBreakLabelModest")?.textContent).toBe(
			"ויקרא א",
		);
	});

	it("can force the modest perek label without any markers", () => {
		const { container } = renderBody({ modestPerekLabels: true });
		expect(container.querySelector(".perekBreakLabelModest")).not.toBeNull();
		expect(container.querySelector("[data-aliyah-marker]")).toBeNull();
	});

	it("keeps the legacy pill label when no markers are passed", () => {
		const { container } = renderBody();
		expect(container.querySelector(".perekBreakLabel")).not.toBeNull();
		expect(container.querySelector(".perekBreakLabelModest")).toBeNull();
		expect(container.querySelector("[data-aliyah-marker]")).toBeNull();
	});

	it("keeps single-perek Haftarah-like spans free of perek chrome", () => {
		const { container } = renderBody({
			ranges: [
				{ start: { perekId: 2, pasuk: 4 }, end: { perekId: 2, pasuk: 19 } },
			],
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// One perek only → no perek label, but the aliyah markers show —
		// every layer at its coordinate, none hidden.
		expect(container.querySelector(".perekBreakLabelModest")).toBeNull();
		expect(
			container.querySelector('[data-aliyah-key~="Bereshit:shabbat"]')
				?.textContent,
		).toContain("שני");
	});
});
