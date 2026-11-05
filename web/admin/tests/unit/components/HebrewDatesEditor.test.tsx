import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HebrewDatesEditor } from "~/components/HebrewDatesEditor";

describe("HebrewDatesEditor", () => {
	it("shows the empty state and adds a default 1 Tishrei row", () => {
		const onChange = vi.fn();
		render(<HebrewDatesEditor dates={[]} onChange={onChange} />);
		expect(screen.getByText("אין תאריכים משויכים")).toBeTruthy();
		fireEvent.click(screen.getByText("+ הוסף תאריך"));
		expect(onChange).toHaveBeenCalledWith([{ hebrew_month: 1, hebrew_day: 1 }]);
	});

	it("renders one row per date and removes the row on delete", () => {
		const onChange = vi.fn();
		render(
			<HebrewDatesEditor
				dates={[
					{ hebrew_month: 11, hebrew_day: 9 },
					{ hebrew_month: 8, hebrew_day: 5 },
				]}
				onChange={onChange}
			/>,
		);
		const removes = screen.getAllByTitle("הסר תאריך");
		expect(removes).toHaveLength(2);
		fireEvent.click(removes[0]);
		expect(onChange).toHaveBeenCalledWith([{ hebrew_month: 8, hebrew_day: 5 }]);
	});

	it("emits an updated row when the day input changes", () => {
		const onChange = vi.fn();
		render(
			<HebrewDatesEditor
				dates={[{ hebrew_month: 11, hebrew_day: 9 }]}
				onChange={onChange}
			/>,
		);
		fireEvent.change(screen.getByDisplayValue("9"), {
			target: { value: "15" },
		});
		expect(onChange).toHaveBeenCalledWith([
			{ hebrew_month: 11, hebrew_day: 15 },
		]);
	});

	it("clamps the stored day to the new month's real maximum on month change", () => {
		const onChange = vi.fn();
		render(
			<HebrewDatesEditor
				dates={[{ hebrew_month: 1, hebrew_day: 30 }]}
				onChange={onChange}
			/>,
		);
		// Month select shows Tishrei (1); switching to Adar II (14) clamps 30 → 29.
		fireEvent.change(screen.getByRole("combobox"), {
			target: { value: "14" },
		});
		expect(onChange).toHaveBeenCalledWith([
			{ hebrew_month: 14, hebrew_day: 29 },
		]);
	});

	it("falls back to a 30-day bound for a month outside the uniform table", () => {
		// Server-side normalization rejects out-of-range months; the editor
		// still renders a stale row sanely while the user fixes it.
		const onChange = vi.fn();
		render(
			<HebrewDatesEditor
				dates={[{ hebrew_month: 99, hebrew_day: 31 }]}
				onChange={onChange}
			/>,
		);
		const input = screen.getByDisplayValue("31");
		expect(input.getAttribute("max")).toBe("30");
	});
});
