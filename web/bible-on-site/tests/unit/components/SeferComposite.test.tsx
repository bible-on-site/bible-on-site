/**
 * @jest-environment jsdom
 */
import { render } from "@testing-library/react";

jest.mock("@/app/929/[number]/components/sefer-composite.module.css", () => ({
	seferOverlay: "seferOverlay",
	visible: "visible",
	hidden: "hidden",
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
}));

const mockGet = jest.fn().mockReturnValue(null);
jest.mock("next/navigation", () => ({
	useSearchParams: () => ({ get: mockGet }),
}));

jest.mock("@/app/929/[number]/components/ReadModeToggler", () => ({
	__esModule: true,
	default: () => <div data-testid="read-mode-toggler" />,
}));

jest.mock("@/app/929/[number]/components/Sefer", () => ({
	__esModule: true,
	default: () => <div data-testid="sefer" />,
}));

import SeferComposite from "@/app/929/[number]/components/SeferComposite";

describe("SeferComposite", () => {
	const minimalPerek = {
		perekId: 5,
		perekHeb: "ה",
		header: "בראשית ה",
		helek: "תורה",
		sefer: "בראשית",
		source: "mechon-mamre" as const,
		pesukim: [],
	};

	it("returns null when viewport is not wide enough", () => {
		const { container } = render(
			<SeferComposite perekObj={minimalPerek} articles={[]} />,
		);
		// isWideEnough is false → component returns null
		expect(container.firstChild).toBeNull();
	});
});
