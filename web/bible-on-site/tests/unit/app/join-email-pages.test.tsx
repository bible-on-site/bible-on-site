/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import JoinEmailPage, { metadata } from "@/app/join/email/page";
import ConfirmEmailPage from "@/app/join/email/confirm/page";
import { newChallengeToken } from "@/lib/bulletin-signup";

jest.mock("server-only", () => ({}));

describe("/join/email", () => {
	it("publishes a canonical, indexable signup page", () => {
		expect(metadata.alternates?.canonical).toBe("/join/email");
		expect(metadata.title).toContain("הרשמה לעלון היומי");
	});

	it("renders the reusable signup form", () => {
		render(<JoinEmailPage />);
		expect(
			screen.getByRole("heading", { name: /הרשמה לעלון היומי בדוא"ל/ }),
		).toBeInTheDocument();
		expect(screen.getByRole("checkbox")).toBeRequired();
		expect(screen.getByRole("link", { name: /אפשרויות ההצטרפות/ })).toHaveAttribute(
			"href",
			"/dailyBulletin",
		);
	});
});

describe("/join/email/confirm", () => {
	const params = (query: Record<string, string>) => ({
		searchParams: Promise.resolve(query),
	});

	it("renders the explicit confirm form for a valid token", async () => {
		const tree = await ConfirmEmailPage(params({ t: newChallengeToken() }));
		render(tree);
		expect(
			screen.getByRole("button", { name: "אישור ההרשמה" }),
		).toBeInTheDocument();
		// The token must live in the hidden form field, never in visible text.
		const input = document.querySelector(
			"input[name='token']",
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(input.type).toBe("hidden");
	});

	it("strips the token from the URL before trackers read it", async () => {
		const tree = await ConfirmEmailPage(params({ t: newChallengeToken() }));
		const { container } = render(tree);
		const script = container.querySelector("script");
		expect(script?.innerHTML).toContain('searchParams.delete("t")');
		expect(script?.innerHTML).toContain("replaceState");
	});

	it("shows the invalid state for a malformed or absent token", async () => {
		for (const query of [{ t: "bad" }, {}] as Record<string, string>[]) {
			const tree = await ConfirmEmailPage(params(query));
			const { unmount } = render(tree);
			expect(screen.getByRole("status")).toHaveTextContent(/אינו תקף/);
			expect(
				screen.queryByRole("button", { name: "אישור ההרשמה" }),
			).toBeNull();
			unmount();
		}
	});

	it.each(["confirmed", "expired", "invalid", "error"] as const)(
		"shows the %s outcome from a form-post redirect",
		async (outcome) => {
			const tree = await ConfirmEmailPage(params({ outcome }));
			const { unmount } = render(tree);
			expect(screen.getByRole("status")).toBeInTheDocument();
			unmount();
		},
	);
});
