/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import {
	DIVINE_NAME_MASKING_KEY,
	getDivineNameMaskingSettings,
} from "@/lib/divine-name-settings";
import {
	READER_SETTINGS_STORAGE_KEY,
	READER_SETTINGS_VERSION,
} from "@/lib/reader-settings";
import {
	getRecitationSettings,
	openReaderSettings,
} from "@/lib/recitation-settings";
import { getSeferBookmarkSettings } from "@/lib/sefer-bookmark-settings";

beforeAll(() => {
	HTMLDialogElement.prototype.showModal = function () {
		this.setAttribute("open", "");
	};
	HTMLDialogElement.prototype.close = function () {
		this.removeAttribute("open");
	};
});
beforeEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute("style");
});
// The DOM externs declare a narrower StorageEvent constructor than the
// runtime one; the subscriber only reads `event.key`, so a plain Event
// carrying the property is enough.
const storageEvent = (key: string | null) =>
	Object.assign(new Event("storage"), { key });
test("one settings button opens display controls and preserves existing preferences", () => {
	localStorage.setItem(
		READER_SETTINGS_STORAGE_KEY,
		JSON.stringify({ fontStep: 3, lineStep: 1 }),
	);
	render(<ReaderSettings />);
	expect(screen.queryByRole("dialog")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveValue("3");
	expect(screen.getByRole("slider", { name: "ריווח אנכי" })).toHaveValue("1");
	fireEvent.change(screen.getByRole("slider", { name: "ריווח אופקי" }), {
		target: { value: "4" },
	});
	expect(
		document.documentElement.style.getPropertyValue("--perek-word-spacing"),
	).toBe("0.44em");
	fireEvent.change(screen.getByRole("slider", { name: "גודל גופן" }), {
		target: { value: "4" },
	});
	fireEvent.change(screen.getByRole("slider", { name: "ריווח אנכי" }), {
		target: { value: "2" },
	});
	expect(
		JSON.parse(localStorage.getItem(READER_SETTINGS_STORAGE_KEY) ?? "null"),
	).toEqual({
		fontStep: 4,
		lineStep: 2,
		wordStep: 4,
		fontId: 0,
		v: READER_SETTINGS_VERSION,
	});
});
test("using the open panel does not close popovers underneath it", () => {
	render(<ReaderSettings />);
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	const outside = jest.fn();
	document.addEventListener("mousedown", outside);
	fireEvent.mouseDown(screen.getByRole("slider", { name: "גודל גופן" }));
	expect(outside).not.toHaveBeenCalled();
	fireEvent.mouseDown(document.body);
	expect(outside).toHaveBeenCalledTimes(1);
	document.removeEventListener("mousedown", outside);
});
test("a fresh reader selects spacing level 3 / 3 and vertical spacing reaches level 5", () => {
	render(<ReaderSettings />);
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	const horizontal = screen.getByRole("slider", { name: "ריווח אופקי" });
	const vertical = screen.getByRole("slider", { name: "ריווח אנכי" });
	expect(horizontal).toHaveValue("2");
	expect(vertical).toHaveValue("2");
	expect(
		horizontal.closest("label")?.querySelector("output"),
	).toHaveTextContent("3");
	expect(vertical.closest("label")?.querySelector("output")).toHaveTextContent(
		"3",
	);
	expect(vertical).toHaveAttribute("max", "4");
	fireEvent.change(vertical, { target: { value: "4" } });
	expect(vertical.closest("label")?.querySelector("output")).toHaveTextContent(
		"5",
	);
	expect(
		document.documentElement.style.getPropertyValue("--perek-line-height"),
	).toBe("2.5");
	expect(
		JSON.parse(localStorage.getItem(READER_SETTINGS_STORAGE_KEY) ?? "null"),
	).toEqual(expect.objectContaining({ lineStep: 4, wordStep: 2 }));
});
test("recitation entry point shows only קריינות without tabs and never leaks into general preferences", () => {
	render(<ReaderSettings />);
	const general = screen.getByRole("button", { name: "הגדרות קריאה" });
	const opener = document.createElement("button");
	document.body.append(opener);
	const expectScoped = () => {
		expect(
			screen.getByRole("dialog", { name: "הגדרות קריינות" }),
		).toBeVisible();
		expect(screen.getByRole("slider", { name: "מהירות" })).toHaveFocus();
		expect(
			screen.queryByRole("navigation", { name: "קטגוריות הגדרות" }),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "תצוגה" })).toBeNull();
		expect(screen.queryByRole("slider", { name: "גודל גופן" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: "הסתר שם השם" })).toBeNull();
	};
	const expectFull = () => {
		expect(screen.getByRole("dialog", { name: "הגדרות קריאה" })).toBeVisible();
		expect(
			screen.getByRole("navigation", { name: "קטגוריות הגדרות" }),
		).toBeVisible();
		expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveFocus();
		fireEvent.click(screen.getByRole("button", { name: "קריינות" }));
		expect(screen.getByRole("slider", { name: "מהירות" })).toBeVisible();
	};
	act(() => openReaderSettings("recitation", opener, true));
	expectScoped();
	fireEvent.change(screen.getByRole("slider", { name: "מהירות" }), {
		target: { value: "1.25" },
	});
	expect(getRecitationSettings().speed).toBe(1.25);
	fireEvent.click(screen.getByRole("button", { name: "סגירת הגדרות" }));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(opener).toHaveFocus();
	fireEvent.click(general);
	expectFull();
	fireEvent.click(screen.getByRole("button", { name: "סגירת הגדרות" }));
	expect(general).toHaveFocus();
	act(() => openReaderSettings("recitation", opener, true));
	expectScoped();
	expect(screen.getByRole("slider", { name: "מהירות" })).toHaveValue("1.25");
	opener.remove();
});
test("chapter shortcut opens the same modal focused on narration and returns focus on close", () => {
	render(<ReaderSettings />);
	const opener = document.createElement("button");
	document.body.append(opener);
	act(() => openReaderSettings("recitation", opener));
	expect(screen.getByRole("slider", { name: "מהירות" })).toHaveFocus();
	expect(screen.queryByRole("slider", { name: "גודל גופן" })).toBeNull();
	fireEvent.change(screen.getByRole("slider", { name: "מהירות" }), {
		target: { value: "1.5" },
	});
	fireEvent.change(screen.getByRole("slider", { name: "עוצמה" }), {
		target: { value: "0.4" },
	});
	fireEvent.change(
		screen.getByRole("combobox", { name: "אורך הפסקה בין פסוקים" }),
		{ target: { value: "1000" } },
	);
	expect(getRecitationSettings()).toEqual({
		speed: 1.5,
		volume: 0.4,
		versePauseMs: 1000,
	});
	fireEvent.change(
		screen.getByRole("combobox", { name: "אורך הפסקה בין פסוקים" }),
		{ target: { value: "original" } },
	);
	expect(getRecitationSettings().versePauseMs).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "תצוגה" }));
	expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveFocus();
	fireEvent.click(screen.getByRole("button", { name: "סגירת הגדרות" }));
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(opener).toHaveFocus();
	opener.remove();
});
test("Escape closes the modal and cross-tab preferences update its controls", () => {
	render(<ReaderSettings />);
	const button = screen.getByRole("button", { name: "הגדרות קריאה" });
	fireEvent.click(button);
	act(() => {
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({ fontStep: 0, lineStep: 2, wordStep: 1 }),
		);
		// Unrelated keys must not refresh the panel; the owned key does.
		window.dispatchEvent(storageEvent("otherPref"));
		// A null key (e.g. localStorage.clear() in another tab) is ignored too.
		window.dispatchEvent(storageEvent(null));
		expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveValue("2");
		window.dispatchEvent(storageEvent(READER_SETTINGS_STORAGE_KEY));
	});
	expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveValue("0");
	fireEvent(
		screen.getByRole("dialog"),
		new Event("cancel", { bubbles: true, cancelable: true }),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(button).toHaveFocus();
});

test("display section exposes הסתר שם השם toggle and per-name choices", () => {
	render(<ReaderSettings />);
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	const toggle = screen.getByRole("checkbox", { name: "הסתר שם השם" });
	// #2404: masking is on by default and אל defaults to א-ל.
	expect(toggle).toBeChecked();
	expect(screen.getByRole("radio", { name: "א-ל" })).toBeChecked();
	// The enable flag is independent of the per-name choices, which keep
	// their own stored values.
	expect(getDivineNameMaskingSettings()).toEqual(
		expect.objectContaining({
			enabled: true,
			elohim: "hyphen",
			yhwh: "heh",
			el: "hyphen",
		}),
	);
	fireEvent.click(screen.getByRole("radio", { name: "אלקים" }));
	expect(getDivineNameMaskingSettings().elohim).toBe("elokim");
	fireEvent.click(screen.getByRole("radio", { name: "ד'" }));
	expect(getDivineNameMaskingSettings().yhwh).toBe("dalet");
	// Custom text stays disabled until אחר is chosen for that name (אל has
	// no אחר option at all).
	const custom = screen.getByRole("textbox", {
		name: "כתיב חלופי עבור שדי",
	});
	expect(custom).toBeDisabled();
	fireEvent.click(
		within(screen.getByRole("group", { name: "אלהים" })).getByRole("radio", {
			name: "אחר",
		}),
	);
	expect(getDivineNameMaskingSettings().elohim).toBe("custom");
	fireEvent.click(
		within(screen.getByRole("group", { name: "שדי" })).getByRole("radio", {
			name: "אחר",
		}),
	);
	fireEvent.change(custom, { target: { value: "אל חי" } });
	expect(getDivineNameMaskingSettings()).toEqual(
		expect.objectContaining({ shaddai: "custom", shaddaiCustom: "אל חי" }),
	);
	fireEvent.click(toggle);
	expect(getDivineNameMaskingSettings()).toEqual(
		expect.objectContaining({ enabled: false, elohim: "custom" }),
	);
	expect(
		JSON.parse(localStorage.getItem(DIVINE_NAME_MASKING_KEY) ?? "null"),
	).toEqual(getDivineNameMaskingSettings());
});

test.each([
	[50, 150],
	[350, 150],
	[150, 50],
	[150, 350],
])(
	"backdrop click at (%i, %i) closes settings while clicks inside keep them open",
	(clientX, clientY) => {
		render(<ReaderSettings />);
		const button = screen.getByRole("button", { name: "הגדרות קריאה" });
		fireEvent.click(button);
		const dialog = screen.getByRole("dialog");
		jest.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
			left: 100,
			top: 100,
			right: 300,
			bottom: 300,
			width: 200,
			height: 200,
			x: 100,
			y: 100,
			toJSON: () => ({}),
		});
		fireEvent.click(dialog, { clientX: 150, clientY: 150 });
		expect(dialog).toBeVisible();
		fireEvent.click(dialog, { clientX, clientY });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(button).toHaveFocus();
	},
);

test("הסתר שם השם is one group whose sub-options are disabled while it is off", () => {
	localStorage.setItem(
		DIVINE_NAME_MASKING_KEY,
		JSON.stringify({
			enabled: false,
			elohim: "custom",
			elohimCustom: "אלוקים",
			shaddai: "asis",
		}),
	);
	render(<ReaderSettings />);
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	const group = screen.getByRole("group", { name: "הסתר שם השם" });
	const toggle = within(group).getByRole("checkbox", { name: "הסתר שם השם" });
	const radios = within(group).getAllByRole("radio");
	const elohimCustom = within(group).getByRole("textbox", {
		name: "כתיב חלופי עבור אלהים",
	});
	const shaddaiCustom = within(group).getByRole("textbox", {
		name: "כתיב חלופי עבור שדי",
	});
	expect(toggle).toBeEnabled();
	expect(toggle).not.toBeChecked();
	for (const radio of radios) expect(radio).toBeDisabled();
	expect(elohimCustom).toBeDisabled();
	expect(shaddaiCustom).toBeDisabled();
	const before = getDivineNameMaskingSettings();
	fireEvent.click(within(group).getByRole("radio", { name: "ד'" }));
	expect(getDivineNameMaskingSettings()).toEqual(before);

	fireEvent.click(toggle);
	expect(toggle).toBeChecked();
	for (const radio of radios) expect(radio).toBeEnabled();
	expect(
		within(screen.getByRole("group", { name: "אלהים" })).getByRole("radio", {
			name: "אחר",
		}),
	).toBeChecked();
	expect(elohimCustom).toBeEnabled();
	expect(elohimCustom).toHaveValue("אלוקים");
	expect(shaddaiCustom).toBeDisabled();
	fireEvent.click(within(group).getByRole("radio", { name: "ד'" }));
	expect(getDivineNameMaskingSettings().yhwh).toBe("dalet");

	fireEvent.click(toggle);
	for (const radio of radios) expect(radio).toBeDisabled();
	expect(elohimCustom).toBeDisabled();
	expect(getDivineNameMaskingSettings()).toEqual(
		expect.objectContaining({
			enabled: false,
			elohim: "custom",
			elohimCustom: "אלוקים",
			yhwh: "dalet",
		}),
	);
});
test("סימניות controls persist chapter-tab preferences and gate option edits on the toggle (#2543)", () => {
	render(<ReaderSettings />);
	fireEvent.click(screen.getByRole("button", { name: "הגדרות קריאה" }));
	const group = screen.getByRole("group", { name: "סימניות פרקים" });
	const toggle = within(group).getByRole("checkbox", {
		name: "סימניות פרקים",
	});
	const placement = within(group).getByRole("combobox", {
		name: "מיקום סימניות",
	});
	expect(toggle).toBeChecked();
	expect(placement).toHaveValue("sides");

	fireEvent.change(placement, { target: { value: "top" } });
	fireEvent.change(
		within(group).getByRole("combobox", { name: "סדר סימניות" }),
		{ target: { value: "title" } },
	);
	fireEvent.click(
		within(group).getByRole("checkbox", { name: "הצג רק פרקים הבאים" }),
	);
	expect(getSeferBookmarkSettings()).toEqual(
		expect.objectContaining({
			enabled: true,
			placement: "top",
			order: "title",
			upcomingOnly: true,
		}),
	);

	fireEvent.click(toggle);
	expect(getSeferBookmarkSettings().enabled).toBe(false);
	expect(placement).toBeDisabled();
	// A disabled fieldset also guards the write path — matching the masking
	// group convention, programmatic edits while hidden must not persist.
	fireEvent.change(placement, { target: { value: "left" } });
	expect(getSeferBookmarkSettings().placement).toBe("top");
	fireEvent.click(toggle);
	expect(placement).toBeEnabled();
});
