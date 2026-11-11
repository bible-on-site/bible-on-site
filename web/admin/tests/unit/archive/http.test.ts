import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	admin: vi.fn(),
	archiver: vi.fn(),
	directory: vi.fn(),
	resolvePath: vi.fn(),
	createFolder: vi.fn(),
	sync: vi.fn(),
	begin: vi.fn(),
	complete: vi.fn(),
	remove: vi.fn(),
	download: vi.fn(),
	part: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/auth", () => ({
	getLoginUrl: () => "https://sso.example/login",
	getLogoutUrl: () => "https://sso.example/logout",
	buildClearSessionCookie: () => "admin_session=; Max-Age=0",
	verifyIdTokenClaims: vi.fn(),
	verifyServiceAccessToken: vi.fn(),
	parseCookie: (header: string, name: string) => {
		const raw = header
			.split(";")
			.map((x) => x.trim())
			.find((x) => x.startsWith(`${name}=`))
			?.slice(name.length + 1);
		return raw ? decodeURIComponent(raw) : null;
	},
}));
vi.mock("~/server/archive/auth", async (original) => ({
	...(await original<typeof import("~/server/archive/auth")>()),
	currentAdmin: mocks.admin,
	currentArchiver: mocks.archiver,
}));
vi.mock("~/server/archive/database", () => ({
	archiveStore: {
		directory: mocks.directory,
		resolvePath: mocks.resolvePath,
		createFolder: mocks.createFolder,
	},
}));
vi.mock("~/server/archive/authors", () => ({
	syncAuthorDirectories: mocks.sync,
}));
vi.mock("~/server/archive/storage", () => ({
	beginUpload: mocks.begin,
	completeUpload: mocks.complete,
	removeUpload: mocks.remove,
	downloadUpload: mocks.download,
	uploadPart: mocks.part,
}));

import { AUTHORS_DIRECTORY, UploadError } from "~/lib/archive";
import { handleArchiveRequest } from "~/server/archive/http";

const author = {
	id: "11111111-1111-1111-1111-111111111111",
	username: "alice",
	role: "archiver",
};
function request(
	path = "/archive/api",
	method = "GET",
	data?: unknown,
	headers: Record<string, string> = {},
) {
	return new Request(`https://admin.example${path}`, {
		method,
		headers: { origin: "https://admin.example", ...headers },
		...(data === undefined
			? {}
			: { body: typeof data === "string" ? data : JSON.stringify(data) }),
	});
}
async function handle(req: Request) {
	return handleArchiveRequest(req, "https://admin.example");
}
beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("ARCHIVE_COGNITO_POOL_ID", "authors");
	vi.stubEnv("ARCHIVE_COGNITO_CLIENT_ID", "archiver-client");
	vi.stubEnv("ARCHIVE_COGNITO_DOMAIN", "authors.example");
	vi.stubEnv("ARCHIVE_ORIGIN", "https://admin.example");
	mocks.admin.mockResolvedValue(null);
	mocks.archiver.mockResolvedValue(author);
	mocks.directory.mockResolvedValue({ id: "home", files: [] });
	global.fetch = vi.fn();
});
afterEach(() => vi.unstubAllEnvs());
it("requires verified sessions and returns private noindex responses", async () => {
	mocks.archiver.mockResolvedValue(null);
	const r = await handle(request());
	expect(r.status).toBe(401);
	expect(r.headers.get("x-robots-tag")).toContain("noindex");
	expect(r.headers.get("cache-control")).toContain("no-store");
	expect(mocks.directory).not.toHaveBeenCalled();
});
it("passes only the verified actor and bounded folder/cursor headers to the store", async () => {
	await handle(
		request("/archive/api", "GET", undefined, {
			"X-Archive-Directory": "home",
			"X-Archive-After": "cursor",
		}),
	);
	expect(mocks.directory).toHaveBeenCalledWith(author, "home", "cursor");
	expect(mocks.sync).not.toHaveBeenCalled();
	await handle(
		request("/archive/api", "GET", undefined, {
			"X-Archive-Directory": AUTHORS_DIRECTORY,
		}),
	);
	expect(mocks.sync).not.toHaveBeenCalled();
	mocks.admin.mockResolvedValue({ ...author, role: "admin" });
	await handle(
		request("/archive/api", "GET", undefined, {
			"X-Archive-Directory": AUTHORS_DIRECTORY,
		}),
	);
	expect(mocks.sync).toHaveBeenCalledOnce();
});
it("decodes named URL paths without trusting them as authorization", async () => {
	mocks.resolvePath.mockResolvedValue("owned-home");
	await handle(
		request("/archive/api", "GET", undefined, {
			"X-Archive-Path": encodeURIComponent("/authors/מחבר"),
		}),
	);
	expect(mocks.resolvePath).toHaveBeenCalledWith(author, "/authors/מחבר");
	expect(mocks.directory).toHaveBeenCalledWith(author, "owned-home", "");
	expect(
		(
			await handle(
				request("/archive/api", "GET", undefined, {
					"X-Archive-Path": "%bad%",
				}),
			)
		).status,
	).toBe(400);
});
it("downloads arbitrary file types only as sandboxed attachments", async () => {
	mocks.download.mockResolvedValue({
		file: { filename: "<script>'().html", size: 3 },
		body: new TextEncoder().encode("abc"),
	});
	const r = await handle(request("/archive/api?download=file"));
	expect(r.headers.get("content-type")).toBe("application/octet-stream");
	expect(r.headers.get("content-disposition")).toContain("attachment;");
	expect(r.headers.get("content-disposition")).toContain("%27%28%29");
	expect(r.headers.get("content-security-policy")).toContain("sandbox");
	expect(await r.text()).toBe("abc");
});
it.each(["POST", "PUT"])(
	"rejects cross-origin %s before authenticating or mutating",
	async (method) => {
		const r = await handle(
			request("/archive/api", method, "{}", {
				origin: "https://attacker.example",
			}),
		);
		expect(r.status).toBe(403);
		expect(mocks.archiver).not.toHaveBeenCalled();
	},
);
it("dispatches uploads, folder creation and completion with server-selected identities", async () => {
	mocks.begin.mockResolvedValue({ id: "file", partSize: 8 });
	const r = await handle(
		request("/archive/api", "POST", {
			action: "start",
			filename: "file.any",
			size: 3,
			directory: "home",
			role: "admin",
		}),
	);
	expect(await r.json()).toEqual({ id: "file", partSize: 8 });
	expect(mocks.begin).toHaveBeenCalledWith(author, "file.any", 3, "home");
	mocks.createFolder.mockResolvedValue({ id: "folder" });
	const folder = await handle(
		request("/archive/api", "POST", {
			action: "mkdir",
			name: "folder",
			directory: "home",
		}),
	);
	expect(folder.status).toBe(200);
	expect(await folder.json()).toEqual({ id: "folder" });
	expect(mocks.createFolder).toHaveBeenCalledWith(
		author,
		expect.any(String),
		"folder",
		"home",
	);
	await handle(
		request("/archive/api", "POST", { action: "complete", id: "file" }),
	);
	expect(mocks.complete).toHaveBeenCalledWith(author, "file");
	await handle(
		request("/archive/api", "POST", { action: "remove", id: "file" }),
	);
	expect(mocks.remove).toHaveBeenCalledWith(author, "file");
	const part = request("/archive/api", "PUT", "abc", {
		"X-Upload-Id": "file",
		"X-Upload-Part": "2",
	});
	expect((await handle(part)).status).toBe(200);
	expect(mocks.part).toHaveBeenCalledWith(author, "file", 2, part);
});
it.each([
	"not json",
	"[]",
	"null",
	JSON.stringify({ action: "unknown" }),
	JSON.stringify({ action: "invalid", id: "x" }),
])("rejects malformed commands %s", async (body) => {
	expect((await handle(request("/archive/api", "POST", body))).status).toBe(
		400,
	);
});
it("bounds command bodies with or without Content-Length", async () => {
	expect(
		(
			await handle(
				request("/archive/api", "POST", "a", { "content-length": "4097" }),
			)
		).status,
	).toBe(413);
	expect(
		(await handle(request("/archive/api", "POST", "a".repeat(4097)))).status,
	).toBe(413);
	expect((await handle(request("/archive/api", "POST"))).status).toBe(413);
	expect((await handle(request("/archive/api", "DELETE"))).status).toBe(405);
});
it("preserves safe domain errors and conceals unexpected provider details", async () => {
	mocks.directory.mockRejectedValueOnce(new UploadError("denied", 404));
	expect((await handle(request())).status).toBe(404);
	mocks.directory.mockRejectedValueOnce(new Error("private secret"));
	const spy = vi.spyOn(console, "error").mockImplementation(() => {});
	const r = await handle(request());
	expect(r.status).toBe(503);
	expect(await r.text()).not.toContain("secret");
	spy.mockRestore();
});
it("logs out expired native sessions and admin SSO separately", async () => {
	mocks.archiver.mockResolvedValue(null);
	let r = await handle(request("/archive/api?logout", "POST"));
	expect((await r.json()).url).toContain("https://authors.example/logout?");
	expect(r.headers.get("set-cookie")).toContain("archive_refresh=;");
	mocks.admin.mockResolvedValue({ ...author, role: "admin" });
	r = await handle(request("/archive/api?logout", "POST"));
	expect((await r.json()).url).toBe("https://sso.example/logout");
	expect(r.headers.getSetCookie()).toContain("admin_session=; Max-Age=0");
});
it("starts native PKCE and reuses the existing admin SSO login", async () => {
	let r = await handle(request("/archive/auth/login"));
	expect(r.status).toBe(302);
	expect(r.headers.get("location")).toContain("code_challenge_method=S256");
	expect(r.headers.get("set-cookie")).toContain("archive_login=");
	r = await handle(request("/archive/auth/admin"));
	expect(r.headers.get("location")).toBe("https://sso.example/login");
	expect(r.headers.get("set-cookie")).toContain("archive_admin_return=1");
	expect((await handle(request("/archive/auth/unknown"))).status).toBe(404);
	expect((await handle(request("/archive/auth/login", "POST"))).status).toBe(
		405,
	);
});
it.each([
	undefined,
	"null",
	"malformed",
	JSON.stringify({ state: "expected", verifier: "v" }),
])("rejects missing/mismatched callback state", async (flow) => {
	const r = await handle(
		request(
			"/archive/auth/callback?code=c&state=wrong",
			"GET",
			undefined,
			flow ? { cookie: `archive_login=${encodeURIComponent(flow)}` } : {},
		),
	);
	expect(r.status).toBe(400);
	expect(r.headers.get("set-cookie")).toContain("Max-Age=0");
	expect(fetch).not.toHaveBeenCalled();
});
it("exchanges a matching PKCE callback without exposing tokens to the page", async () => {
	const flow = encodeURIComponent(
		JSON.stringify({ state: "match", verifier: "verifier" }),
	);
	vi.mocked(fetch).mockResolvedValue(
		new Response(
			JSON.stringify({
				access_token: "private-access",
				refresh_token: "private-refresh",
				expires_in: 7200,
			}),
		),
	);
	const r = await handle(
		request("/archive/auth/callback?code=code&state=match", "GET", undefined, {
			cookie: `archive_login=${flow}`,
		}),
	);
	expect(r.status).toBe(302);
	expect(r.headers.get("location")).toBe("https://admin.example/archive");
	expect(r.headers.get("set-cookie")).toContain("Max-Age=3600");
	expect(r.headers.get("set-cookie")).toContain("Max-Age=86400");
	expect(await r.text()).toBe("");
});
