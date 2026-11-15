/**
 * @jest-environment jsdom
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";

import { SectionDivider } from "@/app/components/SectionDivider";

describe("SectionDivider", () => {
	it("renders a decorative element hidden from assistive technology", () => {
		const { container } = render(<SectionDivider />);
		const divider = container.firstElementChild;
		expect(divider).not.toBeNull();
		expect(divider).toHaveAttribute("aria-hidden", "true");
	});
});

/**
 * The wave assets are the boundary's shape contract (#3267, PR #3293
 * review): the transition must follow the site's non-symmetric artistic
 * language — an asymmetric multi-lobe wave like the sefarim/numbers/
 * contact dividers — never a mirror-symmetric dome.
 */
describe("daily-bulletin-devider assets", () => {
	const assetsDir = resolve(__dirname, "../../../public/root");
	const files = readdirSync(assetsDir).filter((file) =>
		/^daily-bulletin-devider-[a-z]+\.svg$/.test(file),
	);

	it("ships a curve asset for every breakpoint", () => {
		expect(files.sort()).toEqual([
			"daily-bulletin-devider-l.svg",
			"daily-bulletin-devider-m.svg",
			"daily-bulletin-devider-s.svg",
			"daily-bulletin-devider-xl.svg",
			"daily-bulletin-devider-xs.svg",
		]);
	});

	// Sample the wave's top edge at each segment end point: the path is a
	// poly-bezier top boundary closed along the bottom, so each C command's
	// final coordinate pair is a point on the wave.
	it.each(files)("is a multi-lobe NON-symmetric wave: %s", (file) => {
		const svg = readFileSync(resolve(assetsDir, file), "utf8");
		const path = /\bd="([^"]+)"/.exec(svg)?.[1] ?? "";
		expect(path).toMatch(/^M0,/);
		// The wave boundary draws more than one cubic segment — a dome
		// would be a single mirrored curve.
		const segments = [...path.matchAll(/C([^CLMZ]+)/g)].map(
			(match) => match[1],
		);
		expect(segments.length).toBeGreaterThanOrEqual(3);
		const height = Number(/viewBox="0 0 1366 (\d+)/.exec(svg)?.[1]);
		const points = segments.map((segment) => {
			const numbers = segment.match(/[\d.]+/g) ?? [];
			return {
				x: Number(numbers[numbers.length - 2]),
				y: Number(numbers[numbers.length - 1]),
			};
		});
		expect(points.length).toBeGreaterThanOrEqual(3);
		// The left and right halves must not mirror: compare the wave
		// heights (peaks/troughs) on each side of the center.
		const leftYs = points.filter((p) => p.x < 683).map((p) => p.y);
		const rightYs = points.filter((p) => p.x > 683).map((p) => p.y);
		const asymmetry = Math.max(
			Math.abs(Math.min(...leftYs) - Math.min(...rightYs)),
			Math.abs(Math.max(...leftYs) - Math.max(...rightYs)),
		);
		expect(asymmetry).toBeGreaterThan(height * 0.05);
	});
});
