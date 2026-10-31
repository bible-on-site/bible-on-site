/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonLabel } from "../../../src/app/components/Skeleton";

describe("Skeleton", () => {
	it("renders a decorative line placeholder by default", () => {
		const { container } = render(<Skeleton />);
		const block = container.firstElementChild as HTMLElement;
		expect(block.getAttribute("aria-hidden")).toBe("true");
		expect(block.dataset.skeleton).toBe("line");
		expect(block.getAttribute("style")).toBeNull();
	});

	it("applies the variant, logical size and extra class", () => {
		const { container } = render(
			<Skeleton variant="round" width="64px" height="2rem" className="extra" />,
		);
		const block = container.firstElementChild as HTMLElement;
		expect(block.dataset.skeleton).toBe("round");
		expect(block.style.inlineSize).toBe("64px");
		expect(block.style.blockSize).toBe("2rem");
		expect(block.classList.contains("extra")).toBe(true);
	});
});

describe("SkeletonLabel", () => {
	it("keeps the loading text available to assistive technology", () => {
		render(<SkeletonLabel>טוען...</SkeletonLabel>);
		expect(screen.getByText("טוען...")).toBeTruthy();
	});
});
