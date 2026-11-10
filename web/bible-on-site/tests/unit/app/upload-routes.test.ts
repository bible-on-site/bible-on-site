/** @jest-environment node */
jest.mock("server-only", () => ({}));
jest.mock("next/headers", () => ({ cookies: jest.fn() }));
jest.mock("@/lib/uploads/auth", () => ({
	...jest.requireActual("@/lib/uploads/auth"),
	currentUploadUser: jest.fn(),
}));
jest.mock("jose", () => ({
	createRemoteJWKSet: jest.fn(),
	jwtVerify: jest.fn(),
}));
jest.mock("@/lib/uploads/storage", () => ({
	beginUpload: jest.fn(),
	completeUpload: jest.fn(),
	downloadUpload: jest.fn(),
	removeUpload: jest.fn(),
	uploadPart: jest.fn(),
}));
jest.mock("@/lib/uploads/store", () => ({
	uploadStore: { directory: jest.fn() },
}));

import { cookies } from "next/headers";
import { GET, POST, PUT } from "@/app/upload/api/route";
import { GET as authGet } from "@/app/upload/auth/[action]/route";
import { currentUploadUser } from "@/lib/uploads/auth";
import {
	beginUpload,
	completeUpload,
	downloadUpload,
	removeUpload,
	uploadPart,
} from "@/lib/uploads/storage";
import { uploadStore } from "@/lib/uploads/store";
import { UploadError } from "../../../../shared/private-upload";

const user = { id: "11111111-1111-1111-1111-111111111111", username: "alice" };
const jar = { get: jest.fn(), set: jest.fn() };
const req = (data: unknown, origin = "https://site.example") =>
	new Request("https://site.example/upload/api", {
		method: "POST",
		headers: { Origin: origin },
		body: JSON.stringify(data),
	});
beforeEach(() => {
	Object.assign(process.env, {
		UPLOAD_COGNITO_POOL_ID: "pool",
		UPLOAD_COGNITO_CLIENT_ID: "client",
		UPLOAD_COGNITO_DOMAIN: "login.example",
		UPLOAD_ORIGIN: "https://site.example",
	});
	(cookies as jest.Mock).mockResolvedValue(jar);
	jar.get.mockReturnValue(undefined);
	(currentUploadUser as jest.Mock).mockResolvedValue(user);
	global.fetch = jest.fn();
	jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
it("protects every data route when unauthenticated", async () => {
	(currentUploadUser as jest.Mock).mockResolvedValue(null);
	for (const request of [
		new Request("https://site.example/upload/api"),
		req({ action: "start", filename: "x", size: 1 }),
		new Request("https://site.example/upload/api?id=file&part=1", {
			method: "PUT",
			headers: { Origin: "https://site.example" },
			body: "x",
		}),
	]) {
		const response = await GET(request);
		expect(response.status).toBe(401);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
	}
});
it("rejects cross-origin mutations before authenticating or touching storage", async () => {
	expect((await POST(req({}, "https://evil.example"))).status).toBe(403);
	expect(currentUploadUser).not.toHaveBeenCalled();
});
it("lists only the current user's directory", async () => {
	(uploadStore.directory as jest.Mock).mockResolvedValue({ files: [] });
	expect(
		await (await GET(new Request("https://site.example/upload/api"))).json(),
	).toEqual({ files: [] });
	expect(uploadStore.directory).toHaveBeenCalledWith(user.id, user.username);
});
it("serves arbitrary files as safe attachments with no public URL", async () => {
	(downloadUpload as jest.Mock).mockResolvedValue({
		file: { filename: "תוכן'().html", size: 4 },
		body: "html",
	});
	const response = await GET(
		new Request("https://site.example/upload/api?download=file"),
	);
	expect(response.headers.get("Content-Disposition")).toContain(
		"attachment; filename=\"download\"; filename*=UTF-8''",
	);
	expect(response.headers.get("Content-Disposition")).toContain(
		"%27%28%29.html",
	);
	expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
	expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
	expect(downloadUpload).toHaveBeenCalledWith(user, "file");
});
it("dispatches multipart requests using the authenticated user", async () => {
	(beginUpload as jest.Mock).mockResolvedValue({ id: "file", partSize: 8 });
	expect(
		await (await POST(req({ action: "start", filename: "a", size: 4 }))).json(),
	).toEqual({ id: "file", partSize: 8 });
	await POST(req({ action: "complete", id: "file" }));
	expect(completeUpload).toHaveBeenCalledWith(user, "file");
	await POST(req({ action: "remove", id: "file" }));
	expect(removeUpload).toHaveBeenCalledWith(user, "file");
	const request = new Request(
		"https://site.example/upload/api?id=file&part=2",
		{ method: "PUT", headers: { Origin: "https://site.example" }, body: "aa" },
	);
	expect((await PUT(request)).status).toBe(200);
	expect(uploadPart).toHaveBeenCalledWith(user, "file", 2, request);
});
it("allows logout even after the account is disabled", async () => {
	(currentUploadUser as jest.Mock).mockResolvedValue(null);
	const response = await POST(
		new Request("https://site.example/upload/api?logout", {
			method: "POST",
			headers: { Origin: "https://site.example" },
		}),
	);
	expect(response.status).toBe(200);
	expect(jar.set.mock.calls.map((call) => call[0])).toEqual([
		"upload_session",
		"upload_refresh",
	]);
	expect((await response.json()).url).toContain("https://login.example/logout");
});
it("rejects invalid, oversized and unknown requests", async () => {
	for (const data of [{}, { action: "unknown", id: "file" }])
		expect((await POST(req(data))).status).toBe(400);
	expect(
		(
			await POST(
				new Request("https://site.example/upload/api", {
					method: "POST",
					headers: { Origin: "https://site.example" },
					body: "{",
				}),
			)
		).status,
	).toBe(400);
	expect(
		(
			await POST(
				new Request("https://site.example/upload/api", {
					method: "POST",
					headers: { Origin: "https://site.example", "content-length": "9000" },
					body: "{}",
				}),
			)
		).status,
	).toBe(413);
});
it("returns safe errors for denied files and provider outages", async () => {
	(uploadStore.directory as jest.Mock)
		.mockRejectedValueOnce(new UploadError("denied", 404))
		.mockRejectedValueOnce(new Error("secret-database-url"));
	expect(
		(await GET(new Request("https://site.example/upload/api"))).status,
	).toBe(404);
	const response = await GET(new Request("https://site.example/upload/api"));
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("secret-database-url");
});

const auth = (action: string, search = "") =>
	authGet(new Request(`https://site.example/upload/auth/${action}${search}`), {
		params: Promise.resolve({ action }),
	});
it("redirects login to Cognito with a private PKCE cookie", async () => {
	const response = await auth("login");
	expect(response.status).toBe(307);
	expect(response.headers.get("Location")).toContain(
		"code_challenge_method=S256",
	);
	expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
	expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it("rejects callback CSRF, missing codes, bad cookies and unknown auth paths", async () => {
	expect((await auth("unknown")).status).toBe(404);
	expect((await auth("callback")).status).toBe(400);
	jar.get.mockReturnValue({
		value: JSON.stringify({ state: "good", verifier: "v" }),
	});
	expect((await auth("callback", "?state=evil&code=code")).status).toBe(400);
	jar.get.mockReturnValue({ value: "not-json" });
	expect((await auth("callback", "?state=good&code=code")).status).toBe(503);
	expect(fetch).not.toHaveBeenCalled();
});
it("exchanges a verified code, stores HttpOnly tokens and clears the flow cookie", async () => {
	jar.get.mockReturnValue({
		value: JSON.stringify({ state: "good", verifier: "verifier" }),
	});
	(fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({
			access_token: "access",
			refresh_token: "refresh",
			expires_in: 7200,
		}),
	});
	const response = await auth("callback", "?state=good&code=code");
	expect(response.status).toBe(307);
	expect(response.headers.get("Location")).toBe("https://site.example/upload");
	expect(response.headers.get("Set-Cookie")).toContain(
		"upload_refresh=refresh",
	);
	expect((fetch as jest.Mock).mock.calls[0][1].body.get("code_verifier")).toBe(
		"verifier",
	);
	expect(jar.set).toHaveBeenCalledWith(
		"upload_login",
		"",
		expect.objectContaining({ maxAge: 0 }),
	);
});
it.each([{ ok: false }, { ok: true, json: async () => ({}) }])(
	"fails closed on token exchange failure",
	async (tokens) => {
		jar.get.mockReturnValue({
			value: JSON.stringify({ state: "good", verifier: "v" }),
		});
		(fetch as jest.Mock).mockResolvedValue(tokens);
		expect((await auth("callback", "?state=good&code=code")).status).toBe(503);
	},
);
it("supports a token response without a refresh token", async () => {
	jar.get.mockReturnValue({
		value: JSON.stringify({ state: "good", verifier: "v" }),
	});
	(fetch as jest.Mock).mockResolvedValue({
		ok: true,
		json: async () => ({ access_token: "access", expires_in: 3600 }),
	});
	const response = await auth("callback", "?state=good&code=code");
	expect(response.status).toBe(307);
	expect(response.headers.get("Set-Cookie")).not.toContain("upload_refresh");
});
