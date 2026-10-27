/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { ReadingTime } from "@/app/components/ReadingTime";

describe("ReadingTime", () => {
	it("renders the Hebrew reading-time badge", () => {
		render(<ReadingTime estimatedSeconds={60} />);
		expect(screen.getByText("זמן קריאה משוער: דקה")).toBeTruthy();
	});

	it("rounds up to whole minutes", () => {
		render(<ReadingTime estimatedSeconds={310} />);
		expect(screen.getByText("זמן קריאה משוער: 6 דקות")).toBeTruthy();
	});

	it("renders פחות מדקה below one minute", () => {
		render(<ReadingTime estimatedSeconds={30} />);
		expect(screen.getByText("זמן קריאה משוער: פחות מדקה")).toBeTruthy();
	});

	it("renders nothing for unknown or verified-empty metrics", () => {
		const { container: unknown } = render(
			<ReadingTime estimatedSeconds={null} />,
		);
		expect(unknown.firstChild).toBeNull();
		const { container: empty } = render(<ReadingTime estimatedSeconds={0} />);
		expect(empty.firstChild).toBeNull();
	});
});
