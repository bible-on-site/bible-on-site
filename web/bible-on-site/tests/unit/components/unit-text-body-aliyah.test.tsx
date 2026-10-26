/**
 * @jest-environment jsdom
 *
 * Marker rendering coverage for the aliyah boundary layer in
 * UnitTextBody (issue #2519): prominent aliyah markers at exact
 * boundary starts, demoted pasuk-like perek labels alongside them,
 * coincident boundaries rendering without collision, multi-layer
 * markers hidden except the selected key, and the unchanged legacy
 * path when no markers are passed.
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

function renderBody(
	props: Partial<Parameters<typeof UnitTextBody>[0]> = {},
) {
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

describe("aliyah boundary markers", () => {
	it("renders a marker at every boundary's exact start pasuk", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			defaultMarkerKey: layer.defaultKey,
		});
		const spans = container.querySelectorAll("[data-aliyah-marker]");
		const visible = [...spans].filter((el) => !el.hasAttribute("hidden"));
		// Shabbat layer: seven aliyot + maftir.
		expect(visible.map((el) => el.textContent)).toEqual([
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

	it("places each marker inside the boundary pasuk's own span", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			defaultMarkerKey: layer.defaultKey,
		});
		// שני begins at בראשית ב ד — the marker sits inside the pasuk-2-4 span.
		const pasuk = container.querySelector("#pasuk-2-4");
		const marker = pasuk?.querySelector(
			'[data-aliyah-key="Bereshit:shabbat"]',
		);
		expect(marker?.textContent).toBe("שני");
		expect(marker?.hasAttribute("hidden")).toBe(false);
		// מפטיר re-reads the tail: marker inside pasuk-6-5.
		const maftir = container
			.querySelector("#pasuk-6-5")
			?.querySelector('[data-aliyah-key="Bereshit:shabbat"]');
		expect(maftir?.textContent).toBe("מפטיר");
		expect(maftir?.getAttribute("data-aliyah-role")).toBe("maftir");
	});

	it("hides non-selected marker layers for in-place switching", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			defaultMarkerKey: layer.defaultKey,
		});
		const weekdayMarkers = container.querySelectorAll(
			'[data-aliyah-key="Bereshit:weekday"]',
		);
		expect(weekdayMarkers.length).toBe(3);
		for (const el of weekdayMarkers) {
			expect(el.hasAttribute("hidden")).toBe(true);
		}
		// Selecting the weekday key flips visibility — both layers exist
		// in the DOM (no remount needed, scroll position preserved).
		const bothAtOne = container.querySelector("#pasuk-1-6");
		expect(
			bothAtOne?.querySelectorAll("[data-aliyah-marker]").length,
		).toBeGreaterThanOrEqual(1);
	});

	it("demotes perek-break labels while markers are present", () => {
		const { container } = renderBody({
			boundaryMarkers: markers,
			defaultMarkerKey: layer.defaultKey,
		});
		expect(
			container.querySelector(".perekBreakLabelModest"),
		).not.toBeNull();
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
				defaultMarkerKey={vLayer.defaultKey}
			/>,
		);
		const firstPasuk = container.querySelector("#pasuk-91-1");
		expect(
			firstPasuk?.querySelector('[data-aliyah-key="Vayikra:shabbat"]')
				?.textContent,
		).toBe("ראשון");
		// The modest perek label for ויקרא א renders just before it.
		expect(container.textContent).toContain("ויקרא א");
		expect(
			container.querySelector(".perekBreakLabelModest")?.textContent,
		).toBe("ויקרא א");
	});

	it("can force the modest perek label without any markers", () => {
		const { container } = renderBody({ modestPerekLabels: true });
		expect(
			container.querySelector(".perekBreakLabelModest"),
		).not.toBeNull();
		expect(container.querySelector("[data-aliyah-marker]")).toBeNull();
	});

	it("keeps the legacy pill label when no markers are passed", () => {
		const { container } = renderBody();
		expect(
			container.querySelector(".perekBreakLabel"),
		).not.toBeNull();
		expect(container.querySelector(".perekBreakLabelModest")).toBeNull();
		expect(container.querySelector("[data-aliyah-marker]")).toBeNull();
	});

	it("keeps single-perek Haftarah-like spans free of perek chrome", () => {
		const { container } = renderBody({
			ranges: [{ start: { perekId: 2, pasuk: 4 }, end: { perekId: 2, pasuk: 19 } }],
			boundaryMarkers: markers,
			defaultMarkerKey: layer.defaultKey,
		});
		// One perek only → no perek label, but the aliyah marker shows.
		expect(container.querySelector(".perekBreakLabelModest")).toBeNull();
		expect(
			container.querySelector('[data-aliyah-key="Bereshit:shabbat"]')
				?.textContent,
		).toBe("שני");
	});
});
