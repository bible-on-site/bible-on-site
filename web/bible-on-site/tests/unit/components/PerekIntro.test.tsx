import { render, screen } from "@testing-library/react";
import { PerekIntro } from "../../../src/app/929/[number]/components/PerekIntro";
import type { PerekObj } from "../../../src/data/perek-dto";

const perekObj: PerekObj = {
	perekId: 1,
	perekHeb: "א",
	header: "בראשית",
	helek: "תורה",
	sefer: "בראשית",
	source: "בראשית א",
	pesukim: [],
};

it("offers responsive AVIF with a crawlable WebP image and visible context", () => {
	const { container } = render(<PerekIntro perekObj={perekObj} />);

	expect(screen.queryByRole("heading")).toBeNull();
	const source = container.querySelector('picture source[type="image/avif"]');
	expect(source).toHaveAttribute(
		"srcset",
		expect.stringContaining("bereshit-1-creation-640.avif 640w"),
	);
	expect(source).toHaveAttribute(
		"srcset",
		expect.stringContaining("bereshit-1-creation-1600.avif 1600w"),
	);
	const image = screen.getByRole("img", { name: /איור פרשני לבראשית א/ });
	expect(image).toHaveAttribute(
		"src",
		expect.stringContaining("bereshit-1-creation.webp"),
	);
	expect(image).toHaveAttribute("sizes", "(max-width: 768px) 100vw, 960px");
	expect(screen.getByText(/איור פרשני לבראשית א:/)).toBeInTheDocument();
});

it("adds no extra introduction to other perakim", () => {
	const { container } = render(
		<PerekIntro perekObj={{ ...perekObj, perekId: 2, source: "בראשית ב" }} />,
	);
	expect(container).toBeEmptyDOMElement();
});
