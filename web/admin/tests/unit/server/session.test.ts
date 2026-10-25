import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCookieMock, verifyClaimsMock } = vi.hoisted(() => ({
	getCookieMock: vi.fn(),
	verifyClaimsMock: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		handler: (fn: unknown) => fn,
	}),
}));

vi.mock("@tanstack/react-start/server", () => ({
	getCookie: getCookieMock,
}));

vi.mock("~/server/auth", () => ({
	verifyIdTokenClaims: verifyClaimsMock,
}));

import { getEditorIdentity } from "~/server/session";

describe("getEditorIdentity", () => {
	const originalSkipAuth = process.env.SKIP_AUTH;

	beforeEach(() => {
		getCookieMock.mockReset();
		verifyClaimsMock.mockReset();
		delete process.env.SKIP_AUTH;
	});

	afterEach(() => {
		if (originalSkipAuth === undefined) delete process.env.SKIP_AUTH;
		else process.env.SKIP_AUTH = originalSkipAuth;
	});

	it("returns the shared local identity only under SKIP_AUTH", async () => {
		process.env.SKIP_AUTH = "true";

		await expect(getEditorIdentity()).resolves.toEqual({ id: "local" });
		expect(getCookieMock).not.toHaveBeenCalled();
	});

	it("returns the verified Cognito sub", async () => {
		getCookieMock.mockReturnValue("session-token");
		verifyClaimsMock.mockResolvedValue({ sub: "cognito-sub-1" });

		await expect(getEditorIdentity()).resolves.toEqual({
			id: "cognito-sub-1",
		});
		expect(getCookieMock).toHaveBeenCalledWith("admin_session");
		expect(verifyClaimsMock).toHaveBeenCalledWith("session-token");
	});

	it("rejects when no session cookie exists", async () => {
		getCookieMock.mockReturnValue(undefined);

		await expect(getEditorIdentity()).rejects.toThrow(
			"editor identity unavailable",
		);
		expect(verifyClaimsMock).not.toHaveBeenCalled();
	});

	it("rejects an unverifiable session instead of falling back to local", async () => {
		getCookieMock.mockReturnValue("expired-token");
		verifyClaimsMock.mockResolvedValue(null);

		await expect(getEditorIdentity()).rejects.toThrow(
			"editor identity unavailable",
		);
	});

	it("rejects a verified token that carries no sub claim", async () => {
		getCookieMock.mockReturnValue("session-token");
		verifyClaimsMock.mockResolvedValue({});

		await expect(getEditorIdentity()).rejects.toThrow(
			"editor identity unavailable",
		);
	});
});
