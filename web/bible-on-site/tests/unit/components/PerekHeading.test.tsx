import { render, screen } from "@testing-library/react";
import { PerekHeading } from "../../../src/app/929/[number]/components/PerekHeading";
import type { PerekObj } from "../../../src/data/perek-dto";

const perekObj: PerekObj = {
	perekId: 1,
	perekHeb: "א",
	header: "בריאת העולם",
	helek: "תורה",
	sefer: "בראשית",
	source: "בראשית א",
	pesukim: [],
};

it("uses the existing perek header in the SEO view", () => {
	render(<PerekHeading perekObj={perekObj} />);
	expect(
		screen.getByRole("heading", { level: 1, name: "בריאת העולם" }),
	).toBeInTheDocument();
});
