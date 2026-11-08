/**
 * @jest-environment jsdom
 */

jest.mock("next/link", () => ({
	__esModule: true,
	default: ({
		children,
		...rest
	}: {
		children: React.ReactNode;
		href: string;
		className?: string;
	}) => <a {...rest}>{children}</a>,
}));

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ArticleActions } from "../../../src/app/929/[number]/components/ArticleActions";

const baseProps: React.ComponentProps<typeof ArticleActions> = {
	backLabel: "חזרה למאמרים",
	onBack: jest.fn(),
	canonicalPath: "/929/1/1",
	shareTitle: "מאמר לדוגמא - הרב לדוגמא",
	onToggleFullscreen: jest.fn(),
};

const renderActions = (
	props: Partial<React.ComponentProps<typeof ArticleActions>> = {},
) => render(<ArticleActions {...baseProps} {...props} />);

beforeEach(() => {
	jest.clearAllMocks();
	Object.assign(navigator, { share: undefined });
});

describe("ArticleActions", () => {
	it("groups return, share and fullscreen in one labelled command row", () => {
		renderActions();

		const group = screen.getByRole("group", { name: "פעולות מאמר" });
		const commands = within(group).getAllByRole("button");
		expect(commands.map((el) => el.textContent)).toEqual([
			"חזרה למאמרים",
			"שתף",
			"מסך מלא",
		]);
		// Every command shares the single base control system (#2786).
		for (const command of commands) {
			expect(command.className).toContain("action");
		}
	});

	it("renders vector icons kept out of the accessibility tree", () => {
		renderActions();

		const group = screen.getByRole("group", { name: "פעולות מאמר" });
		const icons = group.querySelectorAll("svg");
		expect(icons.length).toBe(3);
		for (const icon of icons) {
			expect(icon.getAttribute("aria-hidden")).toBe("true");
		}
	});

	it("calls onBack from the return command", () => {
		const onBack = jest.fn();
		renderActions({ onBack });

		fireEvent.click(screen.getByRole("button", { name: "חזרה למאמרים" }));
		expect(onBack).toHaveBeenCalledTimes(1);
	});

	it("renders the return command as a real link when backHref is given", () => {
		renderActions({ onBack: undefined, backHref: "/929/1" });

		const back = screen.getByRole("link", { name: "חזרה למאמרים" });
		expect(back.getAttribute("href")).toBe("/929/1");
		expect(screen.queryByRole("button", { name: "חזרה למאמרים" })).toBeNull();
	});

	it("copies the canonical URL to the clipboard and announces it", async () => {
		const writeText = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText },
			share: undefined,
		});

		renderActions();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "שתף" }));
		});

		expect(writeText).toHaveBeenCalledWith(
			`${window.location.origin}/929/1/1`,
		);
		expect(screen.getByRole("button", { name: "הועתק!" })).toBeTruthy();
		// The status region keeps a polite announcement for assistive tech.
		expect(screen.getByRole("status").textContent).toBe("הקישור למאמר הועתק");
	});

	it("surfaces a failure label when sharing cannot complete", async () => {
		const writeText = jest.fn().mockRejectedValue(new Error("denied"));
		Object.assign(navigator, {
			clipboard: { writeText },
			share: undefined,
		});

		renderActions();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "שתף" }));
		});

		expect(screen.getByRole("button", { name: "השיתוף נכשל" })).toBeTruthy();
		expect(screen.getByRole("status").textContent).toBe("השיתוף נכשל");
	});

	it("toggles the fullscreen label without toggle-button semantics", () => {
		const onToggleFullscreen = jest.fn();
		const { rerender } = render(
			<ArticleActions {...baseProps} onToggleFullscreen={onToggleFullscreen} />,
		);

		const enter = screen.getByRole("button", { name: "מסך מלא" });
		// A changing label describes the next action — no aria-pressed (#2786).
		expect(enter.getAttribute("aria-pressed")).toBeNull();
		fireEvent.click(enter);
		expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

		rerender(
			<ArticleActions
				{...baseProps}
				fullscreen
				onToggleFullscreen={onToggleFullscreen}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "יציאה ממסך מלא" }),
		).toBeTruthy();
	});

	it("keeps the command order when fullscreen is unavailable", () => {
		renderActions({ onToggleFullscreen: undefined });

		const group = screen.getByRole("group", { name: "פעולות מאמר" });
		expect(
			within(group)
				.getAllByRole("button")
				.map((el) => el.textContent),
		).toEqual(["חזרה למאמרים", "שתף"]);
	});

	it("marks the row with the flipbook no-flip guard", () => {
		renderActions();

		const group = screen.getByRole("group", { name: "פעולות מאמר" });
		expect(group.getAttribute("data-flipbook-no-flip")).not.toBeNull();
	});
});
