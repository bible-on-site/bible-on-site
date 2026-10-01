import { render, screen } from "@testing-library/react";
import { PerekIntro } from "../../../src/app/929/[number]/components/PerekIntro";
import { sampleImage } from "./perek-image-fixture";

it("offers responsive AVIF with a crawlable WebP image and visible context", () => {
	const { container } = render(<PerekIntro images={[sampleImage]} />);

	expect(screen.queryByRole("heading")).toBeNull();
	const source = container.querySelector('picture source[type="image/avif"]');
	expect(source).toHaveAttribute(
		"srcset",
		expect.stringContaining("sample-640.avif 640w"),
	);
	expect(source).toHaveAttribute(
		"srcset",
		expect.stringContaining("sample-1600.avif 1600w"),
	);
	const image = screen.getByRole("img", { name: sampleImage.alt });
	expect(image).toHaveAttribute("src", expect.stringContaining("sample.webp"));
	expect(screen.getByText(sampleImage.caption)).toBeInTheDocument();
});

it("adds no extra introduction to other perakim", () => {
	const { container } = render(<PerekIntro images={[]} />);
	expect(container).toBeEmptyDOMElement();
});
