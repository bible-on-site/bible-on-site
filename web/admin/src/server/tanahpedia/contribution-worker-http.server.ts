import { verifyContributionWorkerAccessToken } from "../auth";
import { skipAuthEnabled } from "../environment.server";
import {
	ContributionWorkerConflict,
	claimContributionGeneration,
	completeContributionGeneration,
	failContributionGeneration,
} from "./contribution-worker.server";

class WorkerRequestError extends Error {}
async function workerBody(request: Request): Promise<unknown> {
	if (
		!request.headers
			.get("content-type")
			?.split(";", 1)[0]
			.trim()
			.toLowerCase()
			.match(/^application\/json$/)
	)
		throw new WorkerRequestError("JSON is required");
	const reader = request.body?.getReader();
	if (!reader) throw new WorkerRequestError("Request body is required");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > 512000) {
				await reader.cancel();
				throw new WorkerRequestError("Worker response is too large");
			}
			chunks.push(chunk.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		try {
			return JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} catch {
			throw new WorkerRequestError("Invalid JSON");
		}
	} finally {
		reader.releaseLock();
	}
}

/** Workers get only this draft-generation surface. Browser sessions do not
 * authenticate it, and even a model named doradsoft has no review authority. */
export async function handleContributionWorkerRequest(
	request: Request,
): Promise<Response> {
	const headers = { "Cache-Control": "no-store" };
	if (request.method !== "POST")
		return new Response("Method not allowed", {
			status: 405,
			headers: { ...headers, Allow: "POST" },
		});
	const url = new URL(request.url);
	const local =
		skipAuthEnabled() &&
		["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	const token = request.headers
		.get("authorization")
		?.match(/^Bearer\s+(\S+)$/i)?.[1];
	if (
		!local &&
		(!token ||
			token.length > 16000 ||
			!(await verifyContributionWorkerAccessToken(token)))
	)
		return new Response("Unauthorized", { status: 401, headers });
	const action = url.pathname.slice("/api/contributions/worker/".length);
	if (!["claim", "complete", "fail"].includes(action))
		return new Response("Not found", { status: 404, headers });
	try {
		const input = await workerBody(request);
		if (action === "claim") {
			const job = await claimContributionGeneration(input);
			return job
				? Response.json(job, { headers })
				: new Response(null, { status: 204, headers });
		}
		if (action === "complete")
			return Response.json(await completeContributionGeneration(input), {
				headers,
			});
		return Response.json(
			{ updated: await failContributionGeneration(input) },
			{ headers },
		);
	} catch (error) {
		if (error instanceof Error && "code" in error)
			return Response.json(
				{ error: "Generation storage unavailable" },
				{ status: 503, headers },
			);
		const status = error instanceof ContributionWorkerConflict ? 409 : 400;
		return Response.json(
			{
				error:
					error instanceof Error
						? error.message.slice(0, 1000)
						: "Invalid worker request",
			},
			{ status, headers },
		);
	}
}
