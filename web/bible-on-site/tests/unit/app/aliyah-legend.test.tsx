/**
 * @jest-environment jsdom
 *
 * Tests for the parasha Torah-text aliyah marker legend (issue #3165):
 * every applicable division layer renders inline at once, the legend
 * lists each layer in its own marker style, clicking an entry
 * emphasizes its markers without hiding the rest, and the
 * ?reading=/?scheme=/?variant= params the replaced selector accepted
 * keep working as emphasis inputs — mirrored back on selection and
 * never remounting scripture.
 */

const mockReplace = jest.fn();
let currentParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace: mockReplace }),
	usePathname: () => "/פרשה/42",
	useSearchParams: () => currentParams,
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { AliyahLegend } from "../../../src/app/parasha/[unit]/components/AliyahLegend";
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
		<AliyahLegend contexts={CONTEXTS} defaultKey={DEFAULT_KEY} />
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

// Deliver a queued hydration event before passive URL initialization.
// dispatchEvent models React replay, bypassing the native disabled hit test.
function ChooseDuringHydration({
	children,
	label,
}: {
	children: ReactNode;
	label: string;
}) {
	useLayoutEffect(() => {
		screen
			.getByRole("button", { name: label })
			.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	}, [label]);
	return children;
}

const markers = () =>
	Array.from(document.querySelectorAll<HTMLElement>("[data-aliyah-marker]"));
/** Every marker layer stays visible — emphasis never hides one. */
const allVisible = () => markers().every((el) => !el.hidden);
const emphasizedKeys = () =>
	markers()
		.filter((el) => el.hasAttribute("data-aliyah-selected"))
		.map((el) => el.dataset.aliyahKey);
const pressed = (utils: { container: HTMLElement }, name: string) => {
	const btn = Array.from(utils.container.querySelectorAll("button")).find(
		(el) => el.textContent === name,
	);
	if (!btn) throw new Error(`button "${name}" not found`);
	return btn;
};

describe("AliyahLegend", () => {
	beforeEach(() => {
		mockReplace.mockClear();
		currentParams = new URLSearchParams();
	});

	it("lists every rendered layer as a legend entry in its own style", () => {
		const utils = renderLayer();

		const legend = utils.container.querySelector(
			'[role="group"], fieldset',
		) as HTMLElement;
		expect(legend).not.toBeNull();
		const entries = Array.from(
			legend.querySelectorAll("button"),
		) as HTMLElement[];
		// One entry per layer — standalone schemes then the joined
		// context — each carrying its markers' category styling.
		expect(entries.map((el) => el.textContent)).toEqual([
			"שבת",
			"שני וחמישי",
			"מטות-מסעי",
		]);
		expect(entries.map((el) => el.dataset.aliyahCategory)).toEqual([
			"shabbat",
			"weekday",
			"joined",
		]);
		expect(pressed(utils, "מטות-מסעי").getAttribute("title")).toBe(
			"מטות-מסעי · שבת",
		);
	});

	it("emphasizes the default layer while every marker stays visible", () => {
		const utils = renderLayer();

		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");
		expect(pressed(utils, "שני וחמישי").getAttribute("aria-pressed")).toBe(
			"false",
		);
		expect(emphasizedKeys()).toEqual(["matot:shabbat"]);
		expect(allVisible()).toBe(true);
	});

	it("honors reading and scheme params from the URL", () => {
		renderLayer("reading=matot&scheme=weekday");

		expect(emphasizedKeys()).toEqual(["matot:weekday"]);
		expect(allVisible()).toBe(true);
	});

	it("falls back to the default layer on unknown params", () => {
		renderLayer("reading=bogus&scheme=bogus");

		expect(emphasizedKeys()).toEqual(["matot:shabbat"]);
	});

	it("mirrors a non-default selection into the URL", () => {
		const utils = renderLayer();

		fireEvent.click(pressed(utils, "שני וחמישי"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=matot&scheme=weekday",
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(emphasizedKeys()).toEqual(["matot:weekday"]);
		expect(allVisible()).toBe(true);
	});

	it("clears the params when the default layer is re-selected", () => {
		const utils = renderLayer("reading=matot&scheme=weekday");

		fireEvent.click(pressed(utils, "שבת"));

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/42", { scroll: false });
	});

	it("emphasizes a joined-reading layer by its own entry", () => {
		const utils = renderLayer();

		fireEvent.click(pressed(utils, "מטות-מסעי"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=matot-masei&scheme=shabbat",
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(emphasizedKeys()).toEqual(["matot-masei:shabbat"]);
		expect(allVisible()).toBe(true);
	});

	it("falls back to the first context when defaultKey is stale", () => {
		currentParams = new URLSearchParams();
		const utils = render(
			<AliyahLegend contexts={CONTEXTS} defaultKey="gone:shabbat" />,
		);

		// contexts[0] is the standalone — its default layer is emphasized.
		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");
	});

	it("falls back to the first scheme when defaultKey's scheme is stale", () => {
		currentParams = new URLSearchParams();
		const utils = render(
			<AliyahLegend contexts={CONTEXTS} defaultKey="matot:bogus" />,
		);

		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");
	});

	it("emphasizes a merged marker for any of its constituent layers", () => {
		// A coincident boundary renders one merged pill carrying every
		// constituent key space-separated — selecting any of them
		// emphasizes the shared marker.
		const utils = render(
			<>
				<div data-unit-text="">
					<span
						data-aliyah-marker=""
						data-aliyah-key="matot:shabbat matot:weekday"
					/>
					{/* A marker without a key is never emphasized. */}
					<span data-aliyah-marker="" />
				</div>
				<AliyahLegend contexts={CONTEXTS} defaultKey={DEFAULT_KEY} />
			</>,
		);

		expect(emphasizedKeys()).toEqual(["matot:shabbat matot:weekday"]);
		fireEvent.click(pressed(utils, "שני וחמישי"));
		expect(emphasizedKeys()).toEqual(["matot:shabbat matot:weekday"]);
		expect(allVisible()).toBe(true);
	});

	it("falls back to the URL-resolved layer when the offered contexts narrow under the active selection", () => {
		const utils = renderLayer();
		fireEvent.click(pressed(utils, "שני וחמישי")); // selection: matot:weekday

		// The offered contexts shrink before the soft navigation commits —
		// the legend degrades to the URL-resolved layer instead of
		// dereferencing a selection the new options don't carry.
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
				<AliyahLegend contexts={[narrowed]} defaultKey="vayigash:shabbat" />
			</>,
		);

		expect(pressed(utils, "שבת")).toBeDefined();
		expect(emphasizedKeys()).toEqual(["vayigash:shabbat"]);
		expect(allVisible()).toBe(true);
	});
});

describe("AliyahLegend — minhag variants", () => {
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
				<span data-aliyah-marker="" data-aliyah-key={'vayigash:shabbat:חב"ד'} />
			</div>
			<AliyahLegend contexts={[WITH_VARIANT]} defaultKey="vayigash:shabbat" />
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

	it("lists each variant as its own layer entry", () => {
		const utils = renderVariantLayer();

		const entries = Array.from(
			utils.container.querySelectorAll("fieldset button"),
		) as HTMLElement[];
		expect(entries.map((el) => el.textContent)).toEqual(["שבת", 'חב"ד', "חול"]);
		expect(entries.map((el) => el.dataset.aliyahCategory)).toEqual([
			"shabbat",
			"variant",
			"weekday",
		]);
		expect(pressed(utils, 'חב"ד').getAttribute("title")).toBe(
			'פרשת ויגש · שבת · חב"ד',
		);
	});

	it("marks the base split pressed by default alongside all markers", () => {
		const utils = renderVariantLayer();

		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("false");
		expect(emphasizedKeys()).toEqual(["vayigash:shabbat"]);
		expect(allVisible()).toBe(true);
	});

	it("emphasizes the variant layer and mirrors ?variant= into the URL", () => {
		const utils = renderVariantLayer();

		fireEvent.click(pressed(utils, 'חב"ד'));

		expect(mockReplace).toHaveBeenCalledWith(
			`/פרשה/42?variant=${encodeURIComponent('חב"ד')}`,
			{ scroll: false },
		);
		utils.applyNavigation();
		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("true");
		// The variant's emphasis leaves base and weekday markers visible.
		expect(allVisible()).toBe(true);
	});

	it("keeps the first variant click before the initial passive effects", () => {
		const utils = render(
			<ChooseDuringHydration label={'חב"ד'}>
				{makeVariantJsx()}
			</ChooseDuringHydration>,
		);

		expect(mockReplace).toHaveBeenCalledTimes(1);
		expect(mockReplace).toHaveBeenCalledWith(
			`/פרשה/42?variant=${encodeURIComponent('חב"ד')}`,
			{ scroll: false },
		);
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("true");
		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);
	});

	it("disables server-rendered controls until the first click can be handled", () => {
		const container = document.createElement("div");
		const serverDocument = new DOMParser().parseFromString(
			renderToString(makeVariantJsx()),
			"text/html",
		);
		container.replaceChildren(...serverDocument.body.childNodes);
		document.body.append(container);
		const legend = container.querySelector("fieldset");
		expect(legend).toBeDisabled();
		for (const button of container.querySelectorAll("button")) {
			expect(button).toBeDisabled();
		}

		const utils = render(makeVariantJsx(), { container, hydrate: true });
		expect(legend).not.toBeDisabled();
		fireEvent.click(pressed(utils, 'חב"ד'));
		expect(mockReplace).toHaveBeenCalledTimes(1);
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("true");
		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);
	});

	it("resyncs variant emphasis when back and forward commit URL changes", () => {
		const utils = renderVariantLayer(`variant=${encodeURIComponent('חב"ד')}`);
		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);

		currentParams = new URLSearchParams();
		utils.rerender(makeVariantJsx());
		expect(emphasizedKeys()).toEqual(["vayigash:shabbat"]);
		expect(pressed(utils, "שבת").getAttribute("aria-pressed")).toBe("true");

		currentParams = new URLSearchParams(
			`variant=${encodeURIComponent('חב"ד')}`,
		);
		utils.rerender(makeVariantJsx());
		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);
		expect(pressed(utils, 'חב"ד').getAttribute("aria-pressed")).toBe("true");
		expect(allVisible()).toBe(true);
	});

	it("honors a ?variant= param from the URL", () => {
		renderVariantLayer(`variant=${encodeURIComponent('חב"ד')}`);

		expect(emphasizedKeys()).toEqual(['vayigash:shabbat:חב"ד']);
	});

	it("ignores a ?variant= the selected scheme never offered", () => {
		renderVariantLayer("scheme=weekday&variant=bogus");

		expect(emphasizedKeys()).toEqual(["vayigash:weekday"]);
	});

	it("drops the variant when the base split is re-selected", () => {
		const utils = renderVariantLayer(`variant=${encodeURIComponent('חב"ד')}`);

		fireEvent.click(pressed(utils, "שבת"));

		expect(mockReplace).toHaveBeenCalledWith("/פרשה/42", { scroll: false });
	});

	it("drops the variant on scheme switch — variants never carry", () => {
		const utils = renderVariantLayer(`variant=${encodeURIComponent('חב"ד')}`);

		fireEvent.click(pressed(utils, "חול"));

		expect(mockReplace).toHaveBeenCalledWith(
			"/פרשה/42?reading=vayigash&scheme=weekday",
			{ scroll: false },
		);
	});
});
