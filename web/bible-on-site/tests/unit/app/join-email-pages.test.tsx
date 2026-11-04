/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import JoinEmailPage, { metadata } from "@/app/join/email/page";
import ConfirmEmailPage from "@/app/join/email/confirm/page";
import { newChallengeToken } from "@/lib/bulletin-signup";
import { CONFIRM_TOKEN_COOKIE } from "@/lib/bulletin-signup/shared";

jest.mock("server-only", () => ({}));
const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({
	redirect: (url: string) => mockRedirect(url),
}));
const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({
	cookies: () => Promise.resolve({ get: mockCookieGet }),
}));

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
	const staged = (token: string | undefined) =>
		mockCookieGet.mockImplementation((name: string) =>
			name === CONFIRM_TOKEN_COOKIE && token !== undefined
				? { value: token }
				: undefined,
		);

	beforeEach(() => {
		mockRedirect.mockReset();
		mockCookieGet.mockReset().mockReturnValue(undefined);
	});

	it("hands a mailed token off to the cookie hop before rendering", async () => {
		const t = newChallengeToken();
		await ConfirmEmailPage(params({ t }));
		expect(mockRedirect).toHaveBeenCalledWith(
			`/api/bulletin/confirm?t=${encodeURIComponent(t)}`,
		);
	});

	it("renders the explicit confirm form for a staged cookie", async () => {
		staged(newChallengeToken());
		const tree = await ConfirmEmailPage(params({}));
		const { container } = render(tree);
		expect(
			screen.getByRole("button", { name: "אישור ההרשמה" }),
		).toBeInTheDocument();
		// The challenge lives only in the HttpOnly cookie — nothing in the DOM.
		expect(container.querySelector("input[name='token']")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
	});

	it("shows the invalid state for a malformed or absent challenge", async () => {
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

	it("shows the invalid state for a malformed staged cookie", async () => {
		staged("bad");
		const tree = await ConfirmEmailPage(params({}));
		render(tree);
		expect(screen.getByRole("status")).toHaveTextContent(/אינו תקף/);
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
