import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { PerekText } from "../../../src/app/929/[number]/components/PerekText";
import type { PerekObj } from "../../../src/data/perek-dto";
import type { PerekEntityReference } from "../../../src/lib/tanahpedia/service";

jest.mock("next/link", () => ({
	__esModule: true,
	default({ href, children }: { href: string; children: ReactNode }) {
		return <a href={href}>{children}</a>;
	},
}));

const recordingTimeFrame = {
	from: "00:00:00",
	to: "00:00:00",
};

const perekObj: PerekObj = {
	perekId: 1,
	perekHeb: "א",
	header: "בראשית",
	helek: "תורה",
	sefer: "בראשית",
	source: "בראשית א",
	pesukim: [
		{
			segments: [
				{ type: "qri", value: "אוֹר", recordingTimeFrame },
				{ type: "qri", value: "בין", recordingTimeFrame },
				{ type: "qri", value: "אוֹר", recordingTimeFrame },
			],
		},
	],
};

function reference(segmentStart: number): PerekEntityReference {
	return {
		entityId: "light",
		entityName: "אור",
		entityType: "OBJECT",
		entryUniqueName: "אור",
		pasukNumber: 1,
		segmentStart,
		segmentEnd: segmentStart,
	};
}

it("links each recorded occurrence in perek text", () => {
	render(
		<PerekText perekObj={perekObj} entityRefs={[reference(0), reference(2)]} />,
	);

	const links = screen.getAllByRole("link", { name: "אוֹר" });
	expect(links).toHaveLength(2);
	for (const link of links) {
		expect(link).toHaveAttribute("href", "/pedia/%D7%90%D7%95%D7%A8");
	}
	expect(screen.getByText("בין").closest("a")).toBeNull();
});
