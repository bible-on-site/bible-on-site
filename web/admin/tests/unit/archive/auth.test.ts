import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	jwt: vi.fn(),
	send: vi.fn(),
	claims: vi.fn(),
	service: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("jose", async (original) => ({
	...(await original<typeof import("jose")>()),
	createRemoteJWKSet: vi.fn(() => ({})),
	jwtVerify: mocks.jwt,
}));
vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
	CognitoIdentityProviderClient: class {
		send = mocks.send;
	},
	GetUserCommand: class {
		constructor(public input: unknown) {}
	},
}));
vi.mock("~/server/auth", () => ({
	verifyIdTokenClaims: mocks.claims,
	verifyServiceAccessToken: mocks.service,
	parseCookie: (header: string, name: string) =>
		header
			.split(";")
			.map((x) => x.trim())
			.find((x) => x.startsWith(`${name}=`))
			?.slice(name.length + 1) || null,
}));

import { createRemoteJWKSet, errors } from "jose";
import {
	ArchiveCookies,
	authConfig,
	currentAdmin,
	currentArchiver,
	loginFlow,
	requireArchiveOrigin,
	verifyState,
} from "~/server/archive/auth";

const id = "11111111-1111-1111-1111-111111111111";
function jar(cookie = "archive_session=access") {
	return new ArchiveCookies(
		new Request("https://admin.example/archive/api", { headers: { cookie } }),
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("SKIP_AUTH", "false");
	vi.stubEnv("NODE_ENV", "test");
	vi.stubEnv("ARCHIVE_COGNITO_POOL_ID", "author-pool");
	vi.stubEnv("ARCHIVE_COGNITO_CLIENT_ID", "author-client");
	vi.stubEnv("ARCHIVE_COGNITO_DOMAIN", "authors.example");
	vi.stubEnv("ARCHIVE_ORIGIN", "https://admin.example");
	mocks.jwt.mockResolvedValue({
		payload: {
			sub: id,
			token_use: "access",
			client_id: "author-client",
			role: "admin",
		},
	});
	mocks.send.mockResolvedValue({
		Username: "dorad",
		UserAttributes: [
			{ Name: "sub", Value: id },
			{ Name: "name", Value: "מחבר לדוגמה" },
		],
	});
	mocks.claims.mockResolvedValue(null);
	mocks.service.mockResolvedValue(false);
	global.fetch = vi.fn();
});
afterEach(() => vi.unstubAllEnvs());
it("native users remain archivers even with an admin username and claim", async () => {
	expect(await currentArchiver(jar())).toMatchObject({
		id,
		username: "dorad",
		role: "archiver",
		name: "מחבר לדוגמה",
	});
	expect(mocks.jwt).toHaveBeenCalledWith("access", expect.any(Object), {
		issuer: "https://cognito-idp.il-central-1.amazonaws.com/author-pool",
	});
});
it.each([
	{ sub: id, token_use: "id", client_id: "author-client" },
	{ sub: id, token_use: "access", client_id: "admin-client" },
	{ sub: "bad", token_use: "access", client_id: "author-client" },
])("rejects wrong token kind/client/subject", async (payload) => {
	mocks.jwt.mockResolvedValue({ payload });
	expect(await currentArchiver(jar())).toBeNull();
	expect(mocks.send).not.toHaveBeenCalled();
});
it("checks the live identity matches the verified subject and requires a name", async () => {
	mocks.send.mockResolvedValueOnce({
		UserAttributes: [{ Name: "sub", Value: "other" }],
	});
	expect(await currentArchiver(jar())).toBeNull();
	mocks.send.mockResolvedValueOnce({
		UserAttributes: [{ Name: "sub", Value: id }],
	});
	await expect(currentArchiver(jar())).rejects.toMatchObject({ status: 403 });
});
it.each(["NotAuthorizedException", "UserNotFoundException"])(
	"rejects revoked/disabled accounts: %s",
	async (name) => {
		mocks.send.mockRejectedValueOnce(Object.assign(new Error(), { name }));
		expect(await currentArchiver(jar())).toBeNull();
	},
);
it("fails closed on invalid signatures and reports provider outages", async () => {
	mocks.jwt.mockRejectedValueOnce(new errors.JWSSignatureVerificationFailed());
	expect(await currentArchiver(jar())).toBeNull();
	mocks.send.mockRejectedValueOnce(new Error("provider unavailable"));
	await expect(currentArchiver(jar())).rejects.toMatchObject({ status: 503 });
});
it("does not contact Cognito without a session", async () => {
	expect(await currentArchiver(jar(""))).toBeNull();
	expect(mocks.jwt).not.toHaveBeenCalled();
});
it("refreshes expired access with bounded secure HttpOnly cookies", async () => {
	vi.stubEnv("NODE_ENV", "production");
	mocks.jwt.mockRejectedValueOnce(new errors.JWTExpired("expired", {}));
	(fetch as Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ access_token: "renewed", expires_in: 7200 }),
	});
	const cookies = jar("archive_session=expired; archive_refresh=refresh");
	expect(await currentArchiver(cookies)).toMatchObject({ role: "archiver" });
	const response = cookies.apply(new Response());
	expect(response.headers.get("set-cookie")).toContain(
		"archive_session=renewed; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600; Secure",
	);
	expect(response.headers.get("x-robots-tag")).toContain("noindex");
});
it("refreshes a missing access cookie and rejects invalid refresh responses", async () => {
	(fetch as Mock).mockResolvedValueOnce({
		ok: true,
		json: async () => ({ access_token: "renewed", expires_in: 3600 }),
	});
	expect(await currentArchiver(jar("archive_refresh=refresh"))).toMatchObject({
		role: "archiver",
	});
	(fetch as Mock).mockResolvedValueOnce({ ok: false });
	expect(await currentArchiver(jar("archive_refresh=refresh"))).toBeNull();
	(fetch as Mock).mockResolvedValueOnce({
		ok: true,
		json: async () => ({ access_token: "renewed", expires_in: 0 }),
	});
	expect(await currentArchiver(jar("archive_refresh=refresh"))).toBeNull();
	mocks.jwt.mockRejectedValueOnce(new errors.JWTExpired("expired", {}));
	expect(await currentArchiver(jar())).toBeNull();
});
it("only the existing SSO client or scoped service identity grants admin", async () => {
	expect(await currentAdmin(new Request("https://admin.example"))).toBeNull();
	mocks.claims.mockResolvedValue({
		sub: id,
		email: "admin@example.org",
		name: "מנהל",
	});
	expect(
		await currentAdmin(
			new Request("https://admin.example", {
				headers: { cookie: "admin_session=sso" },
			}),
		),
	).toEqual({ id, username: "admin@example.org", name: "מנהל", role: "admin" });
	mocks.claims.mockResolvedValue({ sub: "invalid" });
	expect(
		await currentAdmin(
			new Request("https://admin.example", {
				headers: { cookie: "admin_session=sso" },
			}),
		),
	).toBeNull();
	mocks.service.mockResolvedValue(true);
	expect(
		await currentAdmin(
			new Request("https://admin.example", {
				headers: { authorization: "Bearer service" },
			}),
		),
	).toMatchObject({ role: "admin", username: "admin-service" });
});
it("allows only the established nonproduction development bypass", async () => {
	vi.stubEnv("SKIP_AUTH", "true");
	expect(
		await currentAdmin(new Request("https://admin.example")),
	).toMatchObject({ role: "admin", username: "local-admin" });
	vi.stubEnv("NODE_ENV", "production");
	expect(await currentAdmin(new Request("https://admin.example"))).toBeNull();
});
it("creates distinct PKCE flows and constant-time state checks", () => {
	const first = loginFlow(),
		second = loginFlow();
	const flow = JSON.parse(first.cookie),
		url = new URL(first.url);
	expect(url.searchParams.get("state")).toBe(flow.state);
	expect(url.searchParams.get("code_challenge_method")).toBe("S256");
	expect(url.searchParams.get("redirect_uri")).toBe(
		"https://admin.example/archive/auth/callback",
	);
	expect(first.cookie).not.toBe(second.cookie);
	expect(verifyState(flow.state, flow.state)).toBe(true);
	expect(verifyState(flow.state, "bad")).toBe(false);
	expect(verifyState("same", "diff")).toBe(false);
});
it("requires configured origin and fails closed when deployment is incomplete", () => {
	expect(() =>
		requireArchiveOrigin(
			new Request("https://admin.example", {
				headers: { origin: "https://other.example" },
			}),
		),
	).toThrow();
	expect(() =>
		requireArchiveOrigin(
			new Request("https://admin.example", {
				headers: { origin: "https://admin.example" },
			}),
		),
	).not.toThrow();
	vi.stubEnv("ARCHIVE_COGNITO_POOL_ID", "");
	expect(() => authConfig()).toThrow();
});

it("uses the immutable SSO subject when optional profile claims are absent", async () => {
	mocks.claims.mockResolvedValue({ sub: id });
	expect(
		await currentAdmin(
			new Request("https://admin.example", {
				headers: { cookie: "admin_session=sso" },
			}),
		),
	).toEqual({ id, username: id, name: undefined, role: "admin" });
});
it("keeps native identity scoped to its subject when Cognito omits Username", async () => {
	mocks.send.mockResolvedValue({
		UserAttributes: [
			{ Name: "sub", Value: id },
			{ Name: "name", Value: "מחבר" },
		],
	});
	expect(await currentArchiver(jar())).toMatchObject({
		id,
		username: id,
		role: "archiver",
	});
});
it("reuses the issuer key set across authenticated requests", async () => {
	vi.stubEnv("ARCHIVE_COGNITO_POOL_ID", "cache-regression-pool");
	await currentArchiver(jar());
	await currentArchiver(jar());
	expect(createRemoteJWKSet).toHaveBeenCalledTimes(1);
	expect(mocks.send).toHaveBeenCalledTimes(2);
});
