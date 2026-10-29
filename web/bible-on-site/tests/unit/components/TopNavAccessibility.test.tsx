/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

let mockPathname = "/";
jest.mock("next/navigation", () => ({
	usePathname: () => mockPathname,
}));

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

import { TopNavAccessibility } from "@/app/components/TopNavAccessibility";
import {
	DEFAULT_READER_SETTINGS,
	PEREK_FONT_SCALES,
	READER_SETTINGS_EVENT,
	READER_SETTINGS_STORAGE_KEY,
} from "@/lib/reader-settings";
import {
	DEFAULT_SITE_A11Y_SETTINGS,
	SITE_A11Y_EVENT,
	SITE_A11Y_STORAGE_KEY,
} from "@/lib/site-a11y-settings";

const trigger = () => screen.getByRole("button", { name: "התאמות נגישות" });
const panel = () => screen.queryByRole("dialog", { name: "התאמות נגישות" });

const storedSettings = () =>
	JSON.parse(localStorage.getItem(READER_SETTINGS_STORAGE_KEY) ?? "null");

const storedA11y = () =>
	JSON.parse(localStorage.getItem(SITE_A11Y_STORAGE_KEY) ?? "null");

describe("TopNavAccessibility", () => {
	beforeEach(() => {
		mockPathname = "/";
		localStorage.clear();
		document.documentElement.removeAttribute("style");
		delete document.documentElement.dataset.tanakhFont;
		delete document.documentElement.dataset.a11yContrast;
		delete document.documentElement.dataset.a11yLinks;
	});

	it("renders a labelled disclosure trigger closed by default", () => {
		render(<TopNavAccessibility />);

		const button = trigger();
		expect(button).toHaveAttribute("aria-haspopup", "dialog");
		expect(button).toHaveAttribute("aria-expanded", "false");
		expect(button).toHaveClass("top-nav-accessibility");
		expect(panel()).not.toBeInTheDocument();
	});

	it("opens the menu with display controls, reset and the statement link last", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		const dialog = panel();
		expect(dialog).toBeInTheDocument();
		expect(trigger()).toHaveAttribute("aria-expanded", "true");
		expect(trigger()).toHaveAttribute("aria-controls", dialog?.id);

		for (const name of ["גודל גופן", "ריווח אנכי", "ריווח אופקי"]) {
			expect(screen.getByRole("slider", { name })).toBeInTheDocument();
		}
		expect(
			screen.getByRole("combobox", { name: "גופן פסוקים" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("button", { name: "איפוס התאמות נגישות" }),
		).toBeInTheDocument();

		// The statement link stays the last item — required ordering (#2396).
		const focusables = Array.from(
			dialog?.querySelectorAll("input, select, button, a[href]") ?? [],
		);
		const last = focusables[focusables.length - 1];
		expect(last).toHaveAttribute("href", "/accessibility");
		expect(last).toHaveTextContent("הצהרת נגישות");
	});

	it("closes on Escape and restores focus to the trigger", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		expect(panel()).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(panel()).not.toBeInTheDocument();
		expect(trigger()).toHaveFocus();
	});

	it("closes on outside pointerdown without stealing focus", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		fireEvent.pointerDown(document.body);
		expect(panel()).not.toBeInTheDocument();
	});

	it("adjusts display settings: persists, applies CSS vars and announces through the shared event", () => {
		const events: CustomEvent[] = [];
		window.addEventListener(READER_SETTINGS_EVENT, (e) =>
			events.push(e as CustomEvent),
		);
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		fireEvent.change(screen.getByRole("slider", { name: "גודל גופן" }), {
			target: { value: "7" },
		});

		expect(storedSettings().fontStep).toBe(7);
		expect(
			document.documentElement.style.getPropertyValue("--perek-font-scale"),
		).toBe(String(PEREK_FONT_SCALES[7]));
		expect(events).toHaveLength(1);
	});

	it("resets all six menu-owned adjustments and reports through a live region", () => {
		// Seed an adjusted display state plus unrelated user data.
		localStorage.setItem(
			READER_SETTINGS_STORAGE_KEY,
			JSON.stringify({
				fontStep: 7,
				lineStep: 4,
				wordStep: 4,
				fontId: 1,
				v: 2,
			}),
		);
		localStorage.setItem(
			SITE_A11Y_STORAGE_KEY,
			JSON.stringify({ contrast: true, links: true, v: 1 }),
		);
		localStorage.setItem("recitationSettings", JSON.stringify({ speed: 2 }));
		localStorage.setItem("someOtherUserData", "keep-me");

		render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		expect(screen.getByRole("checkbox", { name: "ניגודיות גבוהה" })).toBeChecked();
		fireEvent.click(
			screen.getByRole("button", { name: "איפוס התאמות נגישות" }),
		);

		expect(storedSettings()).toMatchObject({
			fontStep: DEFAULT_READER_SETTINGS.fontStep,
			lineStep: DEFAULT_READER_SETTINGS.lineStep,
			wordStep: DEFAULT_READER_SETTINGS.wordStep,
			fontId: DEFAULT_READER_SETTINGS.fontId,
		});
		expect(storedA11y()).toMatchObject({
			contrast: false,
			links: false,
		});
		expect(
			document.documentElement.style.getPropertyValue("--perek-font-scale"),
		).toBe("1");
		expect(document.documentElement.dataset.a11yContrast).toBeUndefined();
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).not.toBeChecked();
		// Unrelated keys untouched.
		expect(localStorage.getItem("recitationSettings")).toContain("speed");
		expect(localStorage.getItem("someOtherUserData")).toBe("keep-me");
		// <output> elements also expose the implicit status role — the live
		// region is the explicit <p role="status">.
		const liveRegion = () =>
			panel()?.querySelector('p[role="status"]') as HTMLElement;
		expect(liveRegion()).toHaveTextContent("אופסו לברירת המחדל");

		// Idempotent second reset reports the already-default state.
		fireEvent.click(
			screen.getByRole("button", { name: "איפוס התאמות נגישות" }),
		);
		expect(liveRegion()).toHaveTextContent("כבר נמצאות בברירת המחדל");
	});

	it("mirrors same-tab writes from the reader settings dialog", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		act(() => {
			window.dispatchEvent(
				new CustomEvent(READER_SETTINGS_EVENT, {
					detail: { ...DEFAULT_READER_SETTINGS, wordStep: 4 },
				}),
			);
		});

		expect(screen.getByRole("slider", { name: "ריווח אופקי" })).toHaveValue(
			"4",
		);
	});

	it("toggles persist, apply to <html> and broadcast the change", () => {
		const events: CustomEvent[] = [];
		window.addEventListener(SITE_A11Y_EVENT, (e) =>
			events.push(e as CustomEvent),
		);
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		fireEvent.click(screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }));
		expect(storedA11y()).toMatchObject({ contrast: true, links: false });
		expect(document.documentElement.dataset.a11yContrast).toBe("high");
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();

		fireEvent.click(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		);
		expect(storedA11y()).toMatchObject({ contrast: true, links: true });
		expect(document.documentElement.dataset.a11yLinks).toBe("underlined");
		expect(events).toHaveLength(2);
	});

	it("hydrates the toggles from stored preferences on open", () => {
		localStorage.setItem(
			SITE_A11Y_STORAGE_KEY,
			JSON.stringify({ contrast: true, links: true, v: 1 }),
		);
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).toBeChecked();
	});

	it("ignores a corrupt stored payload and shows defaults", () => {
		localStorage.setItem(SITE_A11Y_STORAGE_KEY, "{not-valid-json");
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).not.toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).not.toBeChecked();
	});

	it("mirrors same-tab writes through the site-a11y event", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		act(() => {
			window.dispatchEvent(
				new CustomEvent(SITE_A11Y_EVENT, {
					detail: { ...DEFAULT_SITE_A11Y_SETTINGS, links: true },
				}),
			);
		});

		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).not.toBeChecked();
	});

	it("mirrors cross-tab writes through the storage event", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		act(() => {
			localStorage.setItem(
				SITE_A11Y_STORAGE_KEY,
				JSON.stringify({ contrast: true, links: false, v: 1 }),
			);
			window.dispatchEvent(
				Object.assign(new Event("storage"), {
					key: SITE_A11Y_STORAGE_KEY,
				}),
			);
		});

		expect(
			screen.getByRole("checkbox", { name: "ניגודיות גבוהה" }),
		).toBeChecked();
		expect(
			screen.getByRole("checkbox", { name: "קו תחתון לקישורים" }),
		).not.toBeChecked();
		// Cross-tab writes re-apply the root attributes in this document too.
		expect(document.documentElement.dataset.a11yContrast).toBe("high");
		expect(document.documentElement.dataset.a11yLinks).toBeUndefined();
	});

	it("mirrors cross-tab reader writes through the storage event", () => {
		render(<TopNavAccessibility />);
		fireEvent.click(trigger());

		act(() => {
			localStorage.setItem(
				READER_SETTINGS_STORAGE_KEY,
				JSON.stringify({ fontStep: 7, v: 2 }),
			);
			window.dispatchEvent(
				Object.assign(new Event("storage"), {
					key: READER_SETTINGS_STORAGE_KEY,
				}),
			);
		});

		expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveValue("7");
	});

	it("closes the menu and clears the announcement when the route changes", () => {
		const { rerender } = render(<TopNavAccessibility />);
		fireEvent.click(trigger());
		fireEvent.click(
			screen.getByRole("button", { name: "איפוס התאמות נגישות" }),
		);
		expect(
			panel()?.querySelector('p[role="status"]'),
		).not.toBeEmptyDOMElement();

		mockPathname = "/929";
		rerender(<TopNavAccessibility />);

		expect(panel()).not.toBeInTheDocument();
	});

	it("docks next to the reader preferences gear on reader routes", () => {
		for (const pathname of [
			"/929/11",
			"/מסורה/1",
			"/masora/1",
			"/פרשה/נח",
			"/parasha/נח",
		]) {
			mockPathname = pathname;
			const { unmount } = render(<TopNavAccessibility />);
			expect(trigger()).toHaveClass("top-nav-accessibility--after-prefs");
			unmount();
		}
		mockPathname = "/search";
		render(<TopNavAccessibility />);
		expect(trigger()).not.toHaveClass("top-nav-accessibility--after-prefs");
		expect(trigger()).not.toHaveClass("top-nav-accessibility--edge");
	});

	it("docks at the left-edge slot where reader routes mount no gear", () => {
		// /929/authors (and its /929/rabbis rewrite alias — the browser keeps
		// the alias in the pathname) suppresses the search button like the
		// rest of the reader section, but mounts no preferences gear —
		// docking at the gear offset would leave an unexplained void.
		for (const pathname of [
			"/929/authors",
			"/929/authors/1",
			"/929/rabbis",
			"/929/rabbis/1",
			"/929",
		]) {
			mockPathname = pathname;
			const { unmount } = render(<TopNavAccessibility />);
			expect(trigger()).toHaveClass("top-nav-accessibility--edge");
			expect(trigger()).not.toHaveClass("top-nav-accessibility--after-prefs");
			unmount();
		}
	});
});
