/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import ReaderSettings from "@/app/929/[number]/components/ReaderSettings";
import { READER_SETTINGS_STORAGE_KEY } from "@/lib/reader-settings";
import {
	getRecitationSettings,
	openReaderSettings,
} from "@/lib/recitation-settings";

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
	).toEqual({ fontStep: 4, lineStep: 2, wordStep: 4, fontId: 0 });
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
		window.dispatchEvent(new Event("storage"));
	});
	expect(screen.getByRole("slider", { name: "גודל גופן" })).toHaveValue("0");
	fireEvent(
		screen.getByRole("dialog"),
		new Event("cancel", { bubbles: true, cancelable: true }),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(button).toHaveFocus();
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
