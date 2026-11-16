/**
 * @jest-environment jsdom
 *
 * Date-label rendering for מועדים על הפרק (#3381): the detail line and
 * the catalogue month chip share the stored `hebrew_month`/`date_label`
 * pair — the month never repeats beside a date that already names it,
 * and empty fields emit no element at all.
 */
import { render, screen } from "@testing-library/react";

import {
	MoedDateLine,
	MoedMonthChip,
} from "@/app/moadim/components/MoedDateLabels";
import type { MoedSummary } from "@/lib/moadim";

const moed = (over: Partial<MoedSummary>): MoedSummary => ({
	id: 1,
	slug: "moed",
	name: "מועד",
	hebrewMonth: null,
	dateLabel: null,
	annualOrder: 1,
	...over,
});

describe("MoedDateLine — detail header date line (#3381)", () => {
	it("renders the date alone when the label already carries the month", () => {
		render(
			<MoedDateLine
				moed={moed({ hebrewMonth: "תשרי", dateLabel: "ג' בתשרי" })}
				className="dateLine"
			/>,
		);
		const line = screen.getByText("ג' בתשרי");
		expect(line.tagName).toBe("P");
		expect(line).toHaveClass("dateLine");
		expect(line.textContent).not.toMatch(/תשרי · /);
	});

	it("joins a standalone month with a date that does not name it", () => {
		render(
			<MoedDateLine moed={moed({ hebrewMonth: "תשרי", dateLabel: "ג'" })} />,
		);
		expect(screen.getByText("תשרי · ג'")).toBeInTheDocument();
	});

	it("renders the month alone when the date is empty", () => {
		render(<MoedDateLine moed={moed({ hebrewMonth: "אייר" })} />);
		expect(screen.getByText("אייר")).toBeInTheDocument();
	});

	it("renders nothing when the moed stores no date content", () => {
		const { container } = render(<MoedDateLine moed={moed({})} />);
		expect(container).toBeEmptyDOMElement();
	});
});

describe("MoedMonthChip — catalogue month chip (#3381)", () => {
	it("renders the month when the date label does not name it", () => {
		render(
			<MoedMonthChip
				moed={moed({ hebrewMonth: "תשרי", dateLabel: "ג'" })}
				className="indexMonth"
			/>,
		);
		const chip = screen.getByText("תשרי");
		expect(chip.tagName).toBe("SPAN");
		expect(chip).toHaveClass("indexMonth");
	});

	it("renders the month when the moed stores no date label", () => {
		render(<MoedMonthChip moed={moed({ hebrewMonth: "אייר" })} />);
		expect(screen.getByText("אייר")).toBeInTheDocument();
	});

	it("renders nothing when the date label already names the month", () => {
		const { container } = render(
			<MoedMonthChip
				moed={moed({ hebrewMonth: "תשרי", dateLabel: "ג' בתשרי" })}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when the moed stores no month", () => {
		const { container } = render(
			<MoedMonthChip moed={moed({ dateLabel: "ג' בתשרי" })} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing for an empty month string", () => {
		const { container } = render(
			<MoedMonthChip moed={moed({ hebrewMonth: "", dateLabel: "ג'" })} />,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
