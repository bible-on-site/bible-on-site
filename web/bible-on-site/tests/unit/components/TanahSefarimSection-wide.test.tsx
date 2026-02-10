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

// Wide screen → useIsWideEnough returns true
jest.mock("@/hooks/useIsWideEnough", () => ({
	TABLET_MIN_WIDTH: 768,
	useIsWideEnough: () => true,
}));

// Mock next/dynamic to render the component synchronously
jest.mock("next/dynamic", () => {
	return (loader: () => Promise<{ default: React.ComponentType }>) => {
		let Component: React.ComponentType | null = null;
		const promise = loader();
		promise.then((mod) => {
			Component = mod.default;
		});
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

describe("TanahSefarimSection (wide screen)", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("navigates to sefer with ?book on wide screen", () => {
		render(<TanahSefarimSection />);
		fireEvent.click(screen.getByTestId("mock-bookshelf"));
		expect(mockPush).toHaveBeenCalledWith("/929/1?book");
	});
});
