/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { BreadcrumbDropdown } from "../../../src/app/929/[number]/components/BreadcrumbDropdown";

function renderTwoDropdowns() {
	render(
		<ol>
			<BreadcrumbDropdown label="ספר" ariaLabel="ספר נוכחי">
				<a href="/929/1">בראשית</a>
			</BreadcrumbDropdown>
			<BreadcrumbDropdown label="פרק" ariaLabel="פרק נוכחי" isCurrentPage>
				<a href="/929/2">ב</a>
			</BreadcrumbDropdown>
			<li>
				<a href="/">בית</a>
			</li>
		</ol>,
	);
	return {
		sefer: screen.getByRole("button", { name: "ספר נוכחי" }),
		perek: screen.getByRole("button", { name: "פרק נוכחי" }),
	};
}

describe("BreadcrumbDropdown", () => {
	it("keeps the server preview disabled until its own click handler hydrates", async () => {
		const dropdown = (
			<ol>
				<BreadcrumbDropdown label="ספר" ariaLabel="ספר נוכחי">
					<a href="/929/1">בראשית</a>
				</BreadcrumbDropdown>
			</ol>
		);
		const container = document.createElement("div");
		const parsed = new DOMParser().parseFromString(
			renderToString(dropdown),
			"text/html",
		);
		container.append(...parsed.body.childNodes);
		document.body.appendChild(container);
		let root: Root | undefined;
		try {
			const button = container.querySelector("button");
			expect(button).toBeDisabled();
			expect(button).toHaveAttribute("aria-expanded", "false");
			const onRecoverableError = jest.fn();
			await act(async () => {
				root = hydrateRoot(container, dropdown, { onRecoverableError });
			});
			expect(container.querySelector("button")).toBe(button);
			expect(button).toBeEnabled();
			expect(onRecoverableError).not.toHaveBeenCalled();
			fireEvent.click(button as HTMLButtonElement);
			expect(button).toHaveAttribute("aria-expanded", "true");
		} finally {
			await act(async () => root?.unmount());
			container.remove();
		}
	});

	it("toggles aria-expanded when its button is activated", () => {
		const { sefer } = renderTwoDropdowns();
		expect(sefer).toHaveAttribute("aria-expanded", "false");
		fireEvent.click(sefer);
		expect(sefer).toHaveAttribute("aria-expanded", "true");
		fireEvent.click(sefer);
		expect(sefer).toHaveAttribute("aria-expanded", "false");
	});

	it("closes on Escape and returns focus to its button", () => {
		const { sefer } = renderTwoDropdowns();
		fireEvent.click(sefer);
		act(() => screen.getByRole("link", { name: "בראשית" }).focus());
		fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
		expect(sefer).toHaveAttribute("aria-expanded", "false");
		expect(sefer).toHaveFocus();
	});

	it("keeps the selector open for a non-Escape key", () => {
		const { sefer } = renderTwoDropdowns();
		fireEvent.click(sefer);
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
		expect(sefer).toHaveAttribute("aria-expanded", "true");
	});
	it("closes on an outside pointer press", () => {
		const { sefer } = renderTwoDropdowns();
		fireEvent.click(sefer);
		fireEvent.pointerDown(screen.getByRole("link", { name: "בית" }));
		expect(sefer).toHaveAttribute("aria-expanded", "false");
	});

	it("closes when an option is selected", () => {
		const { sefer } = renderTwoDropdowns();
		fireEvent.click(sefer);
		fireEvent.click(screen.getByRole("link", { name: "בראשית" }));
		expect(sefer).toHaveAttribute("aria-expanded", "false");
	});

	it("keeps only one selector open when focus moves to another", () => {
		const { sefer, perek } = renderTwoDropdowns();
		fireEvent.click(sefer);
		act(() => perek.focus());
		fireEvent.click(perek);
		expect(sefer).toHaveAttribute("aria-expanded", "false");
		expect(perek).toHaveAttribute("aria-expanded", "true");
		expect(perek.closest("li")).toHaveAttribute("aria-current", "page");
		expect(sefer.closest("li")).not.toHaveAttribute("aria-current");
	});
});
