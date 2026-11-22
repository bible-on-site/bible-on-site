/** @jest-environment jsdom */
import { render } from "@testing-library/react";

import SettingsIcon from "@/app/929/[number]/components/SettingsIcon";

describe("SettingsIcon", () => {
	it("renders a decorative icon hidden from assistive technology", () => {
		const { container } = render(<SettingsIcon />);
		// biome-ignore lint/style/noNonNullAssertion: the component renders a single svg
		const svg = container.querySelector("svg")!;
		expect(svg).toHaveAttribute("aria-hidden", "true");
		expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
	});
});

/**
 * The circular reader-settings button already centers the <svg> element with
 * flexbox, so the painted gear must itself sit on the viewBox midpoint
 * (12, 12): #3706 caught the outline and hub drawn one unit left at x = 11.
 */
describe("SettingsIcon geometry", () => {
	// Walk the path data accumulating absolute coordinates. The asset uses
	// only m/l/h/v (relative) plus L/Z, so a small walker suffices.
	const pathPoints = (d: string) => {
		const tokens = d.match(/[a-z]|-?\.?\d+\.?\d*/gi) ?? [];
		const points: Array<{ x: number; y: number }> = [];
		let i = 0;
		let command = "";
		let x = 0;
		let y = 0;
		let startX = 0;
		let startY = 0;
		while (i < tokens.length) {
			if (/[a-z]/i.test(tokens[i])) {
				command = tokens[i++];
			}
			const number = () => Number(tokens[i++]);
			switch (command) {
				case "m":
				case "l":
					x += number();
					y += number();
					if (command === "m") {
						startX = x;
						startY = y;
						command = "l";
					}
					break;
				case "L":
					x = number();
					y = number();
					break;
				case "h":
					x += number();
					break;
				case "v":
					y += number();
					break;
				case "Z":
					x = startX;
					y = startY;
					break;
				default:
					throw new Error(`unexpected path command: ${command}`);
			}
			points.push({ x, y });
		}
		return points;
	};

	it("paints the gear outline centered on the viewBox midpoint", () => {
		const { container } = render(<SettingsIcon />);
		// biome-ignore lint/style/noNonNullAssertion: the icon renders a single outline path
		const d = container.querySelector("path")!.getAttribute("d")!;
		const points = pathPoints(d);
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);
		expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(12, 5);
		expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(12, 5);
	});

	it("centers the hub circle on the viewBox midpoint", () => {
		const { container } = render(<SettingsIcon />);
		// biome-ignore lint/style/noNonNullAssertion: the icon renders its hub circle
		const circle = container.querySelector("circle")!;
		expect(circle).toHaveAttribute("cx", "12");
		expect(circle).toHaveAttribute("cy", "12");
	});
});
