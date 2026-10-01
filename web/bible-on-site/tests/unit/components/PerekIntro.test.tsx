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

	expect(
		screen.getByRole("heading", { level: 1, name: "בראשית א" }),
	).toBeInTheDocument();
	expect(screen.getByText(/בראשית א מתאר את בריאת העולם/)).toBeInTheDocument();
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
	expect(screen.getByText(/איור פרשני לבראשית א —/)).toBeInTheDocument();
});

it("keeps other perakim text-only until an illustration exists", () => {
	const { container } = render(
		<PerekIntro perekObj={{ ...perekObj, perekId: 2, source: "בראשית ב" }} />,
	);
	expect(
		screen.getByRole("heading", { level: 1, name: "בראשית ב" }),
	).toBeInTheDocument();
	expect(container.querySelector("picture")).toBeNull();
});
