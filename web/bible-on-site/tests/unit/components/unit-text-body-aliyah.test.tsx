/**
 * @jest-environment jsdom
 *
 * Marker rendering coverage for the aliyah boundary layer in
 * UnitTextBody (issues #2519/#3165): every applicable division layer
 * renders inline together at exact boundary starts — tagged,
 * categorized, and focus-revealable — coincident boundaries cluster
 * deterministically, the URL-selected layer emphasizes without hiding
 * the rest, perek labels stay modest alongside them, and the legacy
 * path stays unchanged when no markers are passed.
 */
import { render } from "@testing-library/react";
import { UnitTextBody } from "../../../src/app/components/reading/UnitTextBody";
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
		// marker stays visible regardless of layer (issue #3165).
		const shabbatMarkers = Array.from(
			container.querySelectorAll('[data-aliyah-key="Bereshit:shabbat"]'),
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
		// Weekday markers render beside Shabbat's at their own canonical
		// coordinates; the replaced single-layer switch left no hidden
		// layer behind (issue #3165).
		const weekdayMarkers = container.querySelectorAll(
			'[data-aliyah-key="Bereshit:weekday"]',
		);
		expect(weekdayMarkers.length).toBe(3);
		for (const el of weekdayMarkers) {
			expect(el.hasAttribute("hidden")).toBe(false);
		}
		expect(
			container.querySelectorAll("[data-aliyah-marker][hidden]"),
		).toHaveLength(0);
	});

	it("clusters coincident boundaries deterministically", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// בראשית א א opens the unit under all three layers — base
		// Shabbat, its hebcal variant, then weekday — in the stable
		// scheme→variant→next-scheme order the data contract emits.
		const first = container.querySelector("#pasuk-1-1");
		const keys = Array.from(
			first?.querySelectorAll("[data-aliyah-marker]") ?? [],
		).map((el) => el.getAttribute("data-aliyah-key"));
		expect(keys).toEqual([
			"Bereshit:shabbat",
			"Bereshit:shabbat:alt-hebcal",
			"Bereshit:weekday",
		]);
		// Each marker is tagged so the coincident ראשוןs stay
		// distinguishable.
		expect(clusterOrdinals(first)).toEqual(["ראשון", "ראשון", "ראשון"]);
		const tags = Array.from(
			first?.querySelectorAll(".aliyahMarkerTag") ?? [],
		).map((el) => el.textContent);
		expect(tags).toEqual(["שבת", "חלוקה אחרת", "חול"]);
	});

	it("tags each marker with its layer and exposes richer detail", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		const shabbat2 = must(
			container
				.querySelector("#pasuk-2-4")
				?.querySelector('[data-aliyah-key="Bereshit:shabbat"]'),
		);
		expect(shabbat2.tagName).toBe("BUTTON");
		expect(shabbat2.getAttribute("data-aliyah-category")).toBe("shabbat");
		expect(shabbat2.getAttribute("aria-label")).toBe(
			"פרשת בראשית · קריאת שבת · עלייה שנייה (בראשית ב ד-יט)",
		);
		// Tag + ordinal stay visible without hover; the detail bubble is
		// the CSS-revealed richer layer and is hidden from AT (the
		// button's aria-label already carries it).
		expect(shabbat2.textContent).toContain("שבת");
		expect(shabbat2.textContent).toContain("שני");
		const detail = shabbat2.querySelector(".aliyahMarkerDetail");
		expect(detail?.getAttribute("aria-hidden")).toBe("true");

		const variant2 = container
			.querySelector("#pasuk-2-4")
			?.querySelector('[data-aliyah-key="Bereshit:shabbat:alt-hebcal"]');
		expect(variant2?.getAttribute("data-aliyah-category")).toBe("variant");
		expect(variant2?.getAttribute("aria-label")).toBe(
			"פרשת בראשית · קריאת שבת · חלוקה אחרת · עלייה שנייה (בראשית ב ד-יט)",
		);
	});

	it("places each marker inside the boundary pasuk's own span", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			emphasisMarkerKey: layer.defaultKey,
		});
		// שני begins at בראשית ב ד — the marker sits inside the pasuk-2-4 span.
		const pasuk = container.querySelector("#pasuk-2-4");
		const marker = pasuk?.querySelector('[data-aliyah-key="Bereshit:shabbat"]');
		expect(marker?.textContent).toContain("שני");
		// מפטיר re-reads the tail: marker inside pasuk-6-5.
		const maftir = container
			.querySelector("#pasuk-6-5")
			?.querySelector('[data-aliyah-key="Bereshit:shabbat"]');
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
		expect(emphasized.length).toBe(8);
		for (const el of emphasized) {
			expect(el.getAttribute("data-aliyah-key")).toBe("Bereshit:shabbat");
		}
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
			firstPasuk?.querySelector('[data-aliyah-key="Vayikra:shabbat"]')
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
			container.querySelector('[data-aliyah-key="Bereshit:shabbat"]')
				?.textContent,
		).toContain("שני");
	});
});
