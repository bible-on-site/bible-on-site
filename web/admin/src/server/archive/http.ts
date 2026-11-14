import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { AUTHORS_DIRECTORY, UploadError } from "../../lib/archive";
import { buildClearSessionCookie, getLoginUrl, getLogoutUrl } from "../auth";
import {
	ArchiveCookies,
	authConfig,
	currentAdmin,
	currentArchiver,
	FLOW_COOKIE,
	loginFlow,
	REFRESH_COOKIE,
	requireArchiveOrigin,
	SESSION_COOKIE,
	verifyState,
} from "./auth";
import { syncAuthorDirectories } from "./authors";
import { archiveStore } from "./database";
import {
	beginUpload,
	completeUpload,
	downloadUpload,
	removeUpload,
	uploadPart,
} from "./storage";

async function readCommand(request: Request): Promise<Record<string, unknown>> {
	if (Number(request.headers.get("content-length")) > 4096 || !request.body)
		throw new UploadError("בקשה אינה תקינה", 413);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 4096) throw new UploadError("הבקשה גדולה מדי", 413);
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	try {
		const command: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!command || typeof command !== "object" || Array.isArray(command))
			throw new Error("Invalid command");
		return command as Record<string, unknown>;
	} catch {
		throw new UploadError("בקשה אינה תקינה");
	}
}

async function api(
	request: Request,
	jar: ArchiveCookies,
	origin: string,
): Promise<Response> {
	if (!["GET", "POST", "PUT"].includes(request.method))
		return new Response(null, {
			status: 405,
			headers: { Allow: "GET, POST, PUT" },
		});
	if (request.method !== "GET") requireArchiveOrigin(request);
	const url = new URL(request.url);
	if (request.method === "POST" && url.searchParams.has("logout")) {
		jar.set(SESSION_COOKIE, "", 0);
		jar.set(REFRESH_COOKIE, "", 0);
		if (await currentAdmin(request)) {
			const response = Response.json({ url: getLogoutUrl(origin) });
			response.headers.append("Set-Cookie", buildClearSessionCookie());
			return response;
		}
		const config = authConfig();
		return Response.json({
			url: `https://${config.domain}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: `${config.origin}/archive` })}`,
		});
	}
	const user = (await currentAdmin(request)) || (await currentArchiver(jar));
	if (!user) throw new UploadError("יש להיכנס לחשבון", 401);
	if (request.method === "GET") {
		// Lightweight role lookup for the shared archive top bar — intentionally
		// skips directory resolution and listing work.
		if (url.searchParams.has("session"))
			return Response.json({
				isAdmin: user.role === "admin",
				username: user.name || user.username,
			});
		const id = url.searchParams.get("download");
		if (!id) {
			const directoryId = request.headers.get("X-Archive-Directory") || "";
			const path = request.headers.get("X-Archive-Path");
			let decodedPath = "";
			try {
				decodedPath = path ? decodeURIComponent(path) : "";
			} catch {
				throw new UploadError("נתיב אינו תקין");
			}
			if (
				user.role === "admin" &&
				(directoryId === AUTHORS_DIRECTORY ||
					decodedPath === "/authors" ||
					decodedPath.startsWith("/authors/"))
			)
				await syncAuthorDirectories(user);
			const resolved = decodedPath
				? await archiveStore.resolvePath(user, decodedPath)
				: directoryId;
			return Response.json(
				await archiveStore.directory(
					user,
					resolved,
					request.headers.get("X-Archive-After") || "",
				),
			);
		}
		const { file, body } = await downloadUpload(user, id);
		return new Response(body, {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
				"Content-Length": String(file.size),
				"Content-Security-Policy": "default-src 'none'; sandbox",
			},
		});
	}
	if (request.method === "PUT") {
		await uploadPart(
			user,
			request.headers.get("X-Upload-Id") || "",
			Number(request.headers.get("X-Upload-Part")),
			request,
		);
		return Response.json({ ok: true });
	}
	const data = await readCommand(request);
	const directory = typeof data.directory === "string" ? data.directory : "";
	if (data.action === "mkdir")
		return Response.json(
			await archiveStore.createFolder(user, randomUUID(), data.name, directory),
		);
	if (data.action === "start")
		return Response.json(
			await beginUpload(user, data.filename, data.size, directory),
		);
	if (typeof data.id !== "string") throw new UploadError("מזהה קובץ חסר");
	if (data.action === "complete") await completeUpload(user, data.id);
	else if (data.action === "remove") await removeUpload(user, data.id);
	else throw new UploadError("פעולה אינה תקינה");
	return Response.json({ ok: true });
}

async function auth(
	request: Request,
	jar: ArchiveCookies,
	origin: string,
): Promise<Response> {
	if (request.method !== "GET")
		return new Response(null, { status: 405, headers: { Allow: "GET" } });
	const url = new URL(request.url);
	if (url.pathname === "/archive/auth/admin") {
		jar.set("archive_admin_return", "1", 600);
		return new Response(null, {
			status: 302,
			headers: { Location: getLoginUrl(origin) },
		});
	}
	if (url.pathname === "/archive/auth/login") {
		const flow = loginFlow();
		jar.set(FLOW_COOKIE, flow.cookie, 600);
		return new Response(null, { status: 302, headers: { Location: flow.url } });
	}
	if (url.pathname !== "/archive/auth/callback")
		return new Response(null, { status: 404 });
	const raw = jar.get(FLOW_COOKIE);
	jar.set(FLOW_COOKIE, "", 0);
	let flow: { state?: unknown; verifier?: unknown } | null = null;
	try {
		flow = JSON.parse(raw || "null");
	} catch {
		/* Reject a malformed flow just like missing state. */
	}
	const state = url.searchParams.get("state"),
		code = url.searchParams.get("code");
	if (
		typeof flow?.state !== "string" ||
		typeof flow.verifier !== "string" ||
		!state ||
		!code ||
		!verifyState(flow.state, state)
	)
		throw new UploadError("הכניסה לא אומתה. יש לנסות שוב.");
	const config = authConfig();
	const response = await fetch(`https://${config.domain}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: config.clientId,
			redirect_uri: `${config.origin}/archive/auth/callback`,
			code,
			code_verifier: flow.verifier,
		}),
		cache: "no-store",
	});
	if (!response.ok) throw new Error("Token exchange rejected");
	const data = await response.json();
	if (
		typeof data.access_token !== "string" ||
		!Number.isFinite(data.expires_in) ||
		data.expires_in <= 0
	)
		throw new Error("Invalid token response");
	jar.set(SESSION_COOKIE, data.access_token, Math.min(data.expires_in, 3600));
	jar.set(
		REFRESH_COOKIE,
		typeof data.refresh_token === "string" ? data.refresh_token : "",
		typeof data.refresh_token === "string" ? 86400 : 0,
	);
	return new Response(null, {
		status: 302,
		headers: { Location: `${config.origin}/archive` },
	});
}

export async function handleArchiveRequest(
	request: Request,
	origin: string,
): Promise<Response> {
	const jar = new ArchiveCookies(request);
	try {
		return jar.apply(
			new URL(request.url).pathname === "/archive/api"
				? await api(request, jar, origin)
				: await auth(request, jar, origin),
		);
	} catch (error) {
		if (error instanceof UploadError)
			return jar.apply(
				Response.json({ error: error.message }, { status: error.status }),
			);
		console.error(
			"Private archive request failed",
			error instanceof Error ? error.name : "UnknownError",
		);
		return jar.apply(
			Response.json(
				{ error: "הפעולה נכשלה. אפשר לנסות שוב." },
				{ status: 503 },
			),
		);
	}
}
