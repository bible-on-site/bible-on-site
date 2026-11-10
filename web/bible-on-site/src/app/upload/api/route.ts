import { cookies } from "next/headers";
import {
	authConfig,
	cookieOptions,
	currentUploadUser,
	privateHeaders,
	REFRESH_COOKIE,
	requireUploadOrigin,
	SESSION_COOKIE,
} from "@/lib/uploads/auth";
import {
	beginUpload,
	completeUpload,
	downloadUpload,
	removeUpload,
	uploadPart,
} from "@/lib/uploads/storage";
import { uploadStore } from "@/lib/uploads/store";
import { UploadError } from "../../../../../shared/private-upload";

export const runtime = "nodejs";

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

async function handle(request: Request) {
	try {
		if (request.method !== "GET") requireUploadOrigin(request);
		const url = new URL(request.url);
		// Logout remains available even after expiry or account disablement.
		if (request.method === "POST" && url.searchParams.has("logout")) {
			const jar = await cookies();
			jar.set(SESSION_COOKIE, "", cookieOptions(0));
			jar.set(REFRESH_COOKIE, "", cookieOptions(0));
			const config = authConfig();
			return Response.json(
				{
					url: `https://${config.domain}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: `${config.origin}/upload` })}`,
				},
				{ headers: privateHeaders },
			);
		}
		const user = await currentUploadUser();
		if (!user) throw new UploadError("יש להיכנס לחשבון", 401);
		if (request.method === "GET") {
			const id = url.searchParams.get("download");
			if (!id)
				return Response.json(
					await uploadStore.directory(
						user.id,
						user.username,
						url.searchParams.get("after") || "",
					),
					{ headers: privateHeaders },
				);
			const { file, body } = await downloadUpload(user, id);
			return new Response(body, {
				headers: {
					...privateHeaders,
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
				url.searchParams.get("id") || "",
				Number(url.searchParams.get("part")),
				request,
			);
			return Response.json({ ok: true }, { headers: privateHeaders });
		}
		const data = await readCommand(request);
		if (data.action === "start")
			return Response.json(await beginUpload(user, data.filename, data.size), {
				headers: privateHeaders,
			});
		if (typeof data.id !== "string") throw new UploadError("מזהה קובץ חסר");
		if (data.action === "complete") await completeUpload(user, data.id);
		else if (data.action === "remove") await removeUpload(user, data.id);
		else throw new UploadError("פעולה אינה תקינה");
		return Response.json({ ok: true }, { headers: privateHeaders });
	} catch (error) {
		if (error instanceof UploadError)
			return Response.json(
				{ error: error.message },
				{ status: error.status, headers: privateHeaders },
			);
		console.error(
			"Private upload request failed",
			error instanceof Error ? error.name : "UnknownError",
		);
		return Response.json(
			{ error: "הפעולה נכשלה. אפשר לנסות שוב." },
			{ status: 503, headers: privateHeaders },
		);
	}
}

export { handle as GET, handle as POST, handle as PUT };
