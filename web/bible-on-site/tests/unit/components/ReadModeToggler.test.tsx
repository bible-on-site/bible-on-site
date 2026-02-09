/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("next/image", () => ({
	__esModule: true,
	default: (props: Record<string, unknown>) => (
		<span data-testid="mock-image" data-alt={props.alt as string} />
	),
}));

jest.mock(
	"@/app/929/[number]/components/read-mode-toggler.module.css",
	() => ({
		label: "label",
		input: "input",
		toggleDiv: "toggleDiv",
		bookIcon: "bookIcon",
		noteIcon: "noteIcon",
	}),
);

import ReadModeToggler from "@/app/929/[number]/components/ReadModeToggler";

describe("ReadModeToggler", () => {
	it("toggles internal state without onToggle prop", () => {
		render(<ReadModeToggler toggled={false} />);
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(false);

		fireEvent.click(checkbox);
		expect(checkbox.checked).toBe(true);
	});

	it("calls onToggle when provided", () => {
		const onToggle = jest.fn();
		render(<ReadModeToggler toggled={false} onToggle={onToggle} />);
		const checkbox = screen.getByRole("checkbox");

		fireEvent.click(checkbox);
		expect(onToggle).toHaveBeenCalledWith(true);
	});

	it("updates toggled state when prop changes", () => {
		const { rerender } = render(<ReadModeToggler toggled={false} />);
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox.checked).toBe(false);

		rerender(<ReadModeToggler toggled={true} />);
		expect(checkbox.checked).toBe(true);
	});
});
