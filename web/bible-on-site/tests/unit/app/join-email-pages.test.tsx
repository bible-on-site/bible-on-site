/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import JoinEmailPage, { metadata } from "@/app/dailyBulletin/join/email/page";

jest.mock("server-only", () => ({}));

describe("/dailyBulletin/join/email", () => {
	it("publishes a canonical, indexable signup page", () => {
		expect(metadata.alternates?.canonical).toBe("/dailyBulletin/join/email");
		expect(metadata.title).toContain("הרשמה לעלון היומי");
	});

	it("renders the reusable signup form", () => {
		render(<JoinEmailPage />);
		expect(
			screen.getByRole("heading", { name: /הרשמה לעלון היומי בדוא"ל/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("checkbox")).toBeRequired();
		expect(
			screen.getByRole("link", { name: /אפשרויות ההצטרפות/ }),
		).toHaveAttribute("href", "/dailyBulletin");
	});
});
