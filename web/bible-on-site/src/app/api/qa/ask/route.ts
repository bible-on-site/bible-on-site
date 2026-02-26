import { NextResponse } from "next/server";

const QA_SERVICE_URL =
	process.env.QA_SERVICE_URL ?? "http://127.0.0.1:3004";

/**
 * POST /api/qa/ask — proxy to QA service (Malbim + Or HaChaim + articles RAG).
 * Gracefully returns noAnswer when QA service is unavailable.
 */
export async function POST(request: Request): Promise<NextResponse> {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ answers: [], noAnswer: true },
			{ status: 400 },
		);
	}
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);

		const payload: Record<string, unknown> = {
			question: String(body.question ?? ""),
		};
		if (Array.isArray(body.perekIds) && body.perekIds.length > 0) {
			payload.perekIds = body.perekIds;
		}

		const res = await fetch(`${QA_SERVICE_URL}/ask`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		clearTimeout(timeout);
		const data = await res.json();
		return NextResponse.json(data, { status: res.status });
	} catch {
		return NextResponse.json(
			{ answers: [], noAnswer: true },
			{ status: 200 },
		);
	}
}
