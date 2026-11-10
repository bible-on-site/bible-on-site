/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("jose", () => {
	class JOSEError extends Error {}
	class JWTExpired extends JOSEError {}
	return {
		createRemoteJWKSet: jest.fn(() => "keys"),
		jwtVerify: jest.fn(),
		errors: { JOSEError, JWTExpired },
	};
});

import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { errors, jwtVerify } from "jose";
import { cookies } from "next/headers";
import {
	authConfig,
	cookieOptions,
	currentUploadUser,
	loginFlow,
	requireUploadOrigin,
	verifyState,
} from "@/lib/uploads/auth";

const sub = "11111111-1111-1111-1111-111111111111";
const jar = { get: jest.fn(), set: jest.fn() };
const send = jest.spyOn(
	CognitoIdentityProviderClient.prototype,
	"send",
) as jest.Mock;
beforeEach(() => {
	Object.assign(process.env, {
		UPLOAD_COGNITO_POOL_ID: "pool",
		UPLOAD_COGNITO_CLIENT_ID: "client",
		UPLOAD_COGNITO_DOMAIN: "login.example",
		UPLOAD_ORIGIN: "https://site.example",
	});
	delete process.env.UPLOAD_AWS_REGION;
	(cookies as jest.Mock).mockResolvedValue(jar);
	jar.get.mockImplementation((name) =>
		name === "upload_session" ? { value: "token" } : undefined,
	);
	(jwtVerify as jest.Mock).mockResolvedValue({
		payload: { token_use: "access", client_id: "client", sub },
	});
	send.mockResolvedValue({
		Username: "alice",
		UserAttributes: [{ Name: "sub", Value: sub }],
	});
	global.fetch = jest.fn();
});

it("requires complete configuration and uses a dedicated issuer", () => {
	expect(authConfig().issuer).toBe(
		"https://cognito-idp.il-central-1.amazonaws.com/pool",
	);
	process.env.UPLOAD_AWS_REGION = "eu-west-1";
	expect(authConfig().region).toBe("eu-west-1");
	for (const name of [
		"UPLOAD_COGNITO_POOL_ID",
		"UPLOAD_COGNITO_CLIENT_ID",
		"UPLOAD_COGNITO_DOMAIN",
		"UPLOAD_ORIGIN",
	]) {
		const value = process.env[name];
		delete process.env[name];
		expect(() => authConfig()).toThrow();
		process.env[name] = value;
	}
});
it("does not authenticate absent sessions", async () => {
	jar.get.mockReturnValue(undefined);
	expect(await currentUploadUser()).toBeNull();
	expect(jwtVerify).not.toHaveBeenCalled();
});
it("checks the issuer, access-token type, client ID, immutable subject and live Cognito identity", async () => {
	expect(await currentUploadUser()).toEqual({ id: sub, username: "alice" });
	expect(jwtVerify).toHaveBeenCalledWith("token", "keys", {
		issuer: "https://cognito-idp.il-central-1.amazonaws.com/pool",
	});
	expect(send.mock.calls[0][0].input).toEqual({ AccessToken: "token" });
});
it.each([
	{ token_use: "id", client_id: "client", sub },
	{ token_use: "access", client_id: "admin-client", sub },
	{ token_use: "access", client_id: "client" },
	{ token_use: "access", client_id: "client", sub: "../other" },
])("rejects wrong claims %j", async (payload) => {
	(jwtVerify as jest.Mock).mockResolvedValue({ payload });
	expect(await currentUploadUser()).toBeNull();
	expect(send).not.toHaveBeenCalled();
});
it("rejects mismatched or missing Cognito subjects", async () => {
	send
		.mockResolvedValueOnce({
			UserAttributes: [{ Name: "sub", Value: "other" }],
		})
		.mockResolvedValueOnce({});
	expect(await currentUploadUser()).toBeNull();
	expect(await currentUploadUser()).toBeNull();
});
it("falls back to the immutable subject for an absent username", async () => {
	send.mockResolvedValue({ UserAttributes: [{ Name: "sub", Value: sub }] });
	expect(await currentUploadUser()).toEqual({ id: sub, username: sub });
});
it.each(["NotAuthorizedException", "UserNotFoundException"])(
	"rejects disabled or revoked sessions: %s",
	async (name) => {
		send.mockRejectedValue(Object.assign(new Error(), { name }));
		expect(await currentUploadUser()).toBeNull();
	},
);
it("rejects invalid and expired JWTs without a refresh token", async () => {
	(jwtVerify as jest.Mock)
		.mockRejectedValueOnce(new errors.JOSEError())
		.mockRejectedValueOnce(new errors.JWTExpired("expired", {}));
	expect(await currentUploadUser()).toBeNull();
	expect(await currentUploadUser()).toBeNull();
});
it("reports provider outages without granting access", async () => {
	send.mockRejectedValue(new Error("network"));
	await expect(currentUploadUser()).rejects.toMatchObject({ status: 503 });
});
it("refreshes expired sessions without exposing tokens to JavaScript", async () => {
	jar.get.mockImplementation((name) => ({
		value: name === "upload_refresh" ? "refresh" : "token",
	}));
	(jwtVerify as jest.Mock)
		.mockRejectedValueOnce(new errors.JWTExpired("expired", {}))
		.mockResolvedValueOnce({
			payload: { token_use: "access", client_id: "client", sub },
		});
	(fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ access_token: "new", expires_in: 7200 }),
	});
	expect(await currentUploadUser()).toEqual({ id: sub, username: "alice" });
	expect(jar.set).toHaveBeenCalledWith(
		"upload_session",
		"new",
		expect.objectContaining({ httpOnly: true, maxAge: 3600, path: "/upload" }),
	);
	expect((fetch as jest.Mock).mock.calls[0][1].body.get("refresh_token")).toBe(
		"refresh",
	);
});
it("refreshes when the short-lived access cookie has already expired", async () => {
	jar.get.mockImplementation((name) =>
		name === "upload_refresh" ? { value: "refresh" } : undefined,
	);
	(fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ access_token: "new", expires_in: 300 }),
	});
	expect(await currentUploadUser()).not.toBeNull();
});
it.each([{ ok: false }, { ok: true, json: async () => ({}) }])(
	"rejects failed refreshes",
	async (response) => {
		jar.get.mockImplementation((name) =>
			name === "upload_refresh" ? { value: "refresh" } : undefined,
		);
		(fetch as jest.Mock).mockResolvedValue(response);
		expect(await currentUploadUser()).toBeNull();
	},
);
it("creates unique state and PKCE challenges with fixed callback URLs", () => {
	const flow = loginFlow();
	const second = loginFlow();
	const url = new URL(flow.url);
	const cookie = JSON.parse(flow.cookie);
	expect(url.origin).toBe("https://login.example");
	expect(url.searchParams.get("redirect_uri")).toBe(
		"https://site.example/upload/auth/callback",
	);
	expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	expect(url.searchParams.get("state")).toBe(cookie.state);
	expect(flow.cookie).not.toBe(second.cookie);
	expect(verifyState(cookie.state, cookie.state)).toBe(true);
	expect(verifyState(cookie.state, "other")).toBe(false);
	expect(verifyState("abcd", "abce")).toBe(false);
});
it("requires a matching Origin for mutations", () => {
	expect(() =>
		requireUploadOrigin(
			new Request("https://internal", {
				headers: { Origin: "https://site.example" },
			}),
		),
	).not.toThrow();
	expect(() =>
		requireUploadOrigin(new Request("https://site.example")),
	).toThrow();
	expect(() =>
		requireUploadOrigin(
			new Request("https://site.example", {
				headers: { Origin: "https://evil.example" },
			}),
		),
	).toThrow();
});
it("uses HttpOnly cookies scoped to the private area", () => {
	expect(cookieOptions(600)).toMatchObject({
		httpOnly: true,
		sameSite: "lax",
		path: "/upload",
		maxAge: 600,
	});
});
