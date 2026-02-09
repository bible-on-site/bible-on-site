/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@/app/components/TanahSefarimSection.module.css", () => ({
	section: "section",
	header: "header",
	bookshelfContainer: "bookshelfContainer",
	loading: "loading",
	spinner: "spinner",
	bottomDivider: "bottomDivider",
}));

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => false,
}));

// Mock next/dynamic to render the component synchronously instead of lazy-loading
jest.mock("next/dynamic", () => {
	return (loader: () => Promise<{ default: React.ComponentType }>) => {
		let Component: React.ComponentType | null = null;
		// Load immediately and synchronously
		const promise = loader();
		promise.then((mod) => {
			Component = mod.default;
		});
		// Return a wrapper that renders the component once resolved
		const DynamicComponent = (props: Record<string, unknown>) => {
			if (!Component) return null;
			return <Component {...props} />;
		};
		DynamicComponent.displayName = "DynamicMock";
		return DynamicComponent;
	};
});

// Mock the actual Bookshelf component
jest.mock("@/app/components/Bookshelf/Bookshelf", () => ({
	Bookshelf: ({
		onSeferClick,
	}: { onSeferClick?: (name: string, from: number) => void }) => (
		<button
			data-testid="mock-bookshelf"
			type="button"
			onClick={() => onSeferClick?.("בראשית", 1)}
		>
			Bookshelf
		</button>
	),
}));

import { TanahSefarimSection } from "@/app/components/TanahSefarimSection";

describe("TanahSefarimSection", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders section with header text", () => {
		render(<TanahSefarimSection />);
		expect(screen.getByText('ספרי התנ"ך')).toBeTruthy();
		expect(screen.getByText("בחרו ספר כדי להתחיל ללמוד")).toBeTruthy();
	});

	it("navigates to sefer on click (narrow screen, no ?book)", () => {
		render(<TanahSefarimSection />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});
});
