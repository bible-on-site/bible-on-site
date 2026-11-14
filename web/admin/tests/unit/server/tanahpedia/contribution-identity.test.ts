import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), claims: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({ getCookie: mocks.cookie }));
vi.mock("~/server/auth", () => ({ verifyIdTokenClaims: mocks.claims }));

import { contributionIdentity } from "~/server/tanahpedia/contribution-identity.server";

describe("contribution account identity", () => {
	beforeEach(() => {
		vi.stubEnv("SKIP_AUTH", "");
		vi.stubEnv("TANAHPEDIA_DORADSOFT_SUB", "");
		vi.stubEnv("TANAHPEDIA_DEV_ACTOR", "");
		mocks.cookie.mockReset().mockReturnValue("token");
		mocks.claims.mockReset();
	});
	afterEach(() => vi.unstubAllEnvs());
	it("keeps local sessions unprivileged by default", async () => {
		vi.stubEnv("SKIP_AUTH", "true");
		expect(await contributionIdentity()).toMatchObject({
			id: "dev:local",
			isDoradsoft: false,
		});
		expect(mocks.claims).not.toHaveBeenCalled();
	});
	it("allows an explicit local QA actor outside production", async () => {
		vi.stubEnv("SKIP_AUTH", "true");
		vi.stubEnv("TANAHPEDIA_DEV_ACTOR", "doradsoft");
		expect(await contributionIdentity()).toMatchObject({
			name: "doradsoft",
			isDoradsoft: true,
		});
	});
	it("ignores development impersonation in production", async () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("SKIP_AUTH", "true");
		vi.stubEnv("TANAHPEDIA_DEV_ACTOR", "doradsoft");
		mocks.claims.mockResolvedValue({
			sub: "alice",
			"cognito:username": "alice",
		});
		expect(await contributionIdentity()).toMatchObject({
			id: "alice",
			isDoradsoft: false,
		});
	});
	it("recognizes only the verified canonical username by default", async () => {
		mocks.claims.mockResolvedValue({
			sub: "owner",
			"cognito:username": "doradsoft",
		});
		expect(await contributionIdentity()).toMatchObject({
			id: "owner",
			name: "doradsoft",
			isDoradsoft: true,
		});
	});
	it("uses a configured immutable subject for federated accounts", async () => {
		vi.stubEnv("TANAHPEDIA_DORADSOFT_SUB", "owner");
		mocks.claims.mockResolvedValue({
			sub: "owner",
			"cognito:username": "AWSSSO_dorad",
		});
		expect(await contributionIdentity()).toMatchObject({
			name: "doradsoft",
			isDoradsoft: true,
		});
		mocks.claims.mockResolvedValue({
			sub: "someone-else",
			"cognito:username": "doradsoft",
		});
		expect(await contributionIdentity()).toMatchObject({ isDoradsoft: false });
	});
	it("does not grant authority from a display name or email", async () => {
		mocks.claims.mockResolvedValue({
			sub: "alice",
			name: "doradsoft",
			email: "doradsoft@example.com",
		});
		expect(await contributionIdentity()).toMatchObject({
			name: "עורך",
			isDoradsoft: false,
		});
	});
	it.each([null, {}, { name: "doradsoft" }])(
		"rejects missing verified identity %j",
		async (claims) => {
			mocks.claims.mockResolvedValue(claims);
			await expect(contributionIdentity()).rejects.toThrow("Authenticated");
		},
	);
	it("rejects missing cookies without verifying arbitrary input", async () => {
		mocks.cookie.mockReturnValue(undefined);
		await expect(contributionIdentity()).rejects.toThrow();
		expect(mocks.claims).not.toHaveBeenCalled();
	});
});
