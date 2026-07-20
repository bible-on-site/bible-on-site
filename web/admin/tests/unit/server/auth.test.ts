import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jwtVerifyMock } = vi.hoisted(() => ({
	jwtVerifyMock: vi.fn(),
}));

vi.mock("jose", () => ({
	createRemoteJWKSet: () => ({}),
	jwtVerify: jwtVerifyMock,
}));

async function loadAuth() {
	vi.resetModules();
	return import("~/server/auth");
}

describe("verifyServiceAccessToken", () => {
	beforeEach(() => {
		jwtVerifyMock.mockReset();
		vi.stubEnv("COGNITO_USER_POOL_ID", "pool-id");
		vi.stubEnv("COGNITO_CLIENT_ID", "web-client");
		vi.stubEnv("COGNITO_CLIENT_SECRET", "web-secret");
		vi.stubEnv("COGNITO_DOMAIN", "example.auth.il-central-1.amazoncognito.com");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns false when no service client is configured (feature disabled)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "");
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
		expect(jwtVerifyMock).not.toHaveBeenCalled();
	});

	it("rejects an ID token (wrong token_use)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "id",
				client_id: "svc-client",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("rejects a token minted for a different client_id", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "admin-web-app",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("rejects a token missing the required scope", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "svc-client",
				scope: "some-other/scope",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});

	it("accepts a valid service access token", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockResolvedValue({
			payload: {
				token_use: "access",
				client_id: "svc-client",
				scope: "admin-api/service",
			},
		});
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(true);
	});

	it("returns false when jwtVerify throws (invalid signature/expired)", async () => {
		vi.stubEnv("COGNITO_SERVICE_CLIENT_ID", "svc-client");
		jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
		const { verifyServiceAccessToken } = await loadAuth();

		expect(await verifyServiceAccessToken("token")).toBe(false);
	});
});
