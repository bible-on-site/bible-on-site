/**
 * @jest-environment jsdom
 *
 * Tests for the parasha Torah-text aliyah marker selector (issue
 * #2519): default selection, ?reading=/?scheme= URL mirroring, the
 * scheme-retention/fallback rule across context switches, and the
 * in-place marker visibility toggle that never remounts scripture.
 */

const mockReplace = jest.fn();
let currentParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/פרשה/42",
	useSearchParams: () => currentParams,
}));

import { fireEvent, render } from "@testing-library/react";
import { AliyahControls } from "../../../src/app/parasha/[unit]/components/AliyahControls";
import type { UnitAliyahContextOption } from "../../../src/data/parasha/parasha-aliyot";

/** A standalone context with both schemes plus a shabbat-only joined
 * context — the shape a unit in a joined reading gets. */
const STANDALONE: UnitAliyahContextOption = {
	contextId: "matot",
	label: "פרשת מטות",
	kind: "standalone",
	schemes: [
		{ schemeId: "shabbat", label: "שבת", variants: [] },
		{ schemeId: "weekday", label: "שני וחמישי", variants: [] },
	],
};
const JOINED: UnitAliyahContextOption = {
	contextId: "matot-masei",
	label: "מטות-מסעי",
	kind: "joined",
	schemes: [{ schemeId: "shabbat", label: "שבת", variants: [] }],
};
const CONTEXTS = [STANDALONE, JOINED];
const DEFAULT_KEY = "matot:shabbat";

const makeJsx = () => (
	<>
		<div data-unit-text="">
			<span data-aliyah-marker="" data-aliyah-key="matot:shabbat" />
			<span data-aliyah-marker="" data-aliyah-key="matot:weekday" />
			<span data-aliyah-marker="" data-aliyah-key="matot-masei:shabbat" />
		</div>
		<AliyahControls contexts={CONTEXTS} defaultKey={DEFAULT_KEY} />
	</>
);

function renderLayer(params = "") {
	currentParams = new URLSearchParams(params);
	const utils = render(makeJsx());
	return {
		...utils,
		/** Simulates navigation: apply the URL router.replace received. */
		applyNavigation() {
			const url = String(mockReplace.mock.calls.at(-1)?.[0] ?? "");
			currentParams = new URLSearchParams(url.split("?")[1] ?? "");
			utils.rerender(makeJsx());
		},
	};
}

const markers = () =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-aliyah-marker]"));
const visibleKeys = () =>
	markers()
		.filter((el) => !el.hidden)
		.map((el) => el.dataset.aliyahKey);
const pressed = (utils: { container: HTMLElement }, name: string) => {
	const btn = Array.from(utils.container.querySelectorAll("button")).find(
		(el) => el.textContent === name,
	);
	if (!btn) throw new Error(`button "${name}" not found`);
	return btn;
};

describe("AliyahControls", () => {
	beforeEach(() => {
		mockReplace.mockClear();
		currentParams = new URLSearchParams();
	});

	it("selects the default layer and shows only its markers", () => {
		const utils = renderLayer();

		expect(pressed(utils, "פרשת מטות").getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(pressed(utils, "מטות-מסעי").getAttribute("aria-pressed")).toBe(
			"false",
		);
		expect(visibleKeys()).toEqual(["matot:shabbat"]);
	});

	it("honors reading and scheme params from the URL", () => {
		renderLayer("reading=matot&scheme=weekday");

		expect(visibleKeys()).toEqual(["matot:weekday"]);
	});

	it("falls back to the default layer on unknown params", () => {
		renderLayer("reading=bogus&scheme=bogus");

		expect(visibleKeys()).toEqual(["matot:shabbat"]);
	});

	it("mirrors a non-default selection into the URL", () => {
		const utils = renderLayer();

		fireEvent.click(pressed(utils, "שני וחמישי"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=matot&scheme=weekday",
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(visibleKeys()).toEqual(["matot:weekday"]);
	});

	it("clears the params when the default layer is re-selected", () => {
		const utils = renderLayer("reading=matot&scheme=weekday");

		fireEvent.click(pressed(utils, "שבת"));

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/42", { scroll: false });
	});

	it("keeps the current scheme when the new context offers it", () => {
		const utils = renderLayer("reading=matot-masei&scheme=shabbat");

		fireEvent.click(pressed(utils, "פרשת מטות"));

		// matot:shabbat is the default layer — params cleared.
		expect(mockReplace).toHaveBeenCalledWith("/פרשה/42", { scroll: false });
	});

	it("falls back to shabbat when the new context lacks the scheme", () => {
		const utils = renderLayer("reading=matot&scheme=weekday");

		fireEvent.click(pressed(utils, "מטות-מסעי"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=matot-masei&scheme=shabbat",
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(visibleKeys()).toEqual(["matot-masei:shabbat"]);
	});

	it("falls back to the first context when defaultKey is stale", () => {
		currentParams = new URLSearchParams();
		const utils = render(
			<AliyahControls contexts={CONTEXTS} defaultKey="gone:shabbat" />,
		);

		// contexts[0] is the standalone — its default layer shows.
		expect(pressed(utils, "פרשת מטות").getAttribute("aria-pressed")).toBe(
			"true",
		);
	});

	it("falls back to the first scheme when defaultKey's scheme is stale", () => {
		currentParams = new URLSearchParams();
		const utils = render(
			<AliyahControls contexts={CONTEXTS} defaultKey="matot:bogus" />,
		);

		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");
	});

	it("falls back to the URL-resolved layer when the offered contexts narrow under the active selection", () => {
		const utils = renderLayer();
		fireEvent.click(pressed(utils, "שני וחמישי")); // selection: matot:weekday

		// The offered contexts shrink before the soft navigation commits —
		// the buttons degrade to the URL-resolved context's schemes instead
		// of dereferencing a selection the new options don't carry.
		const narrowed: UnitAliyahContextOption = {
			contextId: "vayigash",
			label: "פרשת ויגש",
			kind: "standalone",
			schemes: [{ schemeId: "shabbat", label: "שבת", variants: [] }],
		};
		utils.rerender(
			<>
				<div data-unit-text="">
					<span data-aliyah-marker="" data-aliyah-key="vayigash:shabbat" />
				</div>
				<AliyahControls contexts={[narrowed]} defaultKey="vayigash:shabbat" />
			</>,
		);

		expect(pressed(utils, "פרשת ויגש")).toBeDefined();
		expect(pressed(utils, "שבת")).toBeDefined();
		expect(visibleKeys()).toEqual(["vayigash:shabbat"]);
	});

	it("falls back to the new context's first scheme when it lacks both the current scheme and shabbat", () => {
		const customOnly: UnitAliyahContextOption = {
			contextId: "matot-special",
			label: "מטות מיוחד",
			kind: "joined",
			schemes: [{ schemeId: "mincha", label: "מנחה", variants: [] }],
		};
		currentParams = new URLSearchParams("reading=matot&scheme=weekday");
		const utils = render(
			<AliyahControls
				contexts={[...CONTEXTS, customOnly]}
				defaultKey={DEFAULT_KEY}
			/>,
		);

		fireEvent.click(pressed(utils, "מטות מיוחד"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=matot-special&scheme=mincha",
			{ scroll: false },
		);
	});
});

describe("AliyahControls — minhag variants", () => {
	beforeEach(() => {
		mockReplace.mockClear();
		currentParams = new URLSearchParams();
	});

	/** A context whose shabbat scheme carries one variant division —
	 * the ויגש חב"ד shape: base split plus a documented alternative. */
	const WITH_VARIANT: UnitAliyahContextOption = {
		contextId: "vayigash",
		label: "פרשת ויגש",
		kind: "standalone",
		schemes: [
			{
				schemeId: "shabbat",
				label: "שבת",
				variants: [{ variantId: 'חב"ד', label: 'חב"ד' }],
			},
			{ schemeId: "weekday", label: "חול", variants: [] },
		],
	};

	const makeVariantJsx = () => (
		<>
			<div data-unit-text="">
				<span data-aliyah-marker="" data-aliyah-key="vayigash:shabbat" />
				<span data-aliyah-marker="" data-aliyah-key="vayigash:weekday" />
				<span
					data-aliyah-marker=""
					data-aliyah-key={'vayigash:shabbat:חב"ד'}
				/>
			</div>
			<AliyahControls
				contexts={[WITH_VARIANT]}
				defaultKey="vayigash:shabbat"
			/>
		</>
	);

	function renderVariantLayer(params = "") {
		currentParams = new URLSearchParams(params);
		const utils = render(makeVariantJsx());
		return {
			...utils,
			applyNavigation() {
				const url = String(mockReplace.mock.calls.at(-1)?.[0] ?? "");
				currentParams = new URLSearchParams(url.split("?")[1] ?? "");
				utils.rerender(makeVariantJsx());
			},
		};
	}

	it("offers the מנהג group only when the selected scheme has variants", () => {
		const utils = renderVariantLayer();

		expect(pressed(utils, "נפוץ")).toBeDefined();
		expect(pressed(utils, 'חב"ד')).toBeDefined();

		fireEvent.click(pressed(utils, "חול"));
		utils.applyNavigation();
		// The weekday scheme carries no variant — the group disappears.
		expect(utils.container.textContent).not.toContain("נפוץ");
	});

	it("marks the base split pressed by default and shows base markers", () => {
		const utils = renderVariantLayer();

		expect(pressed(utils, "נפוץ").getAttribute("aria-pressed")).toBe("true");
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("false");
		expect(visibleKeys()).toEqual(["vayigash:shabbat"]);
	});

	it("swaps to the variant layer and mirrors ?variant= into the URL", () => {
		const utils = renderVariantLayer();

		fireEvent.click(pressed(utils, 'חב"ד'));

		expect(mockReplace).toHaveBeenCalledWith(
			`/פרשה/42?variant=${encodeURIComponent('חב"ד')}`,
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(visibleKeys()).toEqual(['vayigash:shabbat:חב"ד']);
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("true");
	});

	it("honors a ?variant= param from the URL", () => {
		renderVariantLayer(`variant=${encodeURIComponent('חב"ד')}`);

		expect(visibleKeys()).toEqual(['vayigash:shabbat:חב"ד']);
	});

	it("ignores a ?variant= the selected scheme never offered", () => {
		renderVariantLayer("scheme=weekday&variant=bogus");

		expect(visibleKeys()).toEqual(["vayigash:weekday"]);
	});

	it("drops the variant when the base split is re-selected", () => {
		const utils = renderVariantLayer(
			`variant=${encodeURIComponent('חב"ד')}`,
		);

		fireEvent.click(pressed(utils, "נפוץ"));

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/42", { scroll: false });
	});

	it("drops the variant on scheme switch — variants never carry", () => {
		const utils = renderVariantLayer(
			`variant=${encodeURIComponent('חב"ד')}`,
		);

		fireEvent.click(pressed(utils, "חול"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=vayigash&scheme=weekday",
			{ scroll: false },
		);
	});
});
