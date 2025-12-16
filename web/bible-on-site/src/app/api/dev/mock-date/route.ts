import { NextResponse } from "next/server";

// Dev API for E2E tests to mock the server date via environment variable
// Only available on localhost in development mode

function isDevLocalhost(request: Request): boolean {
	if (process.env.NODE_ENV !== "development") {
		return false;
	}
	const host = request.headers.get("host");
	return !!host && (host.includes("localhost") || host.includes("127.0.0.1"));
}

export function GET(request: Request) {
	if (!isDevLocalhost(request)) {
		return new NextResponse("Forbidden", { status: 403 });
	}
	return NextResponse.json({
		mockedDate: process.env.MOCK_DATE ?? null,
	});
}

export async function POST(request: Request) {
	if (!isDevLocalhost(request)) {
		return new NextResponse("Forbidden", { status: 403 });
	}
	let body: { date?: string | null };
	try {
		body = await request.json();
	} catch (err) {
		console.warn("Failed to parse JSON body:", err);
		return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
	}
	if (body.date === null || body.date === undefined) {
		delete process.env.MOCK_DATE;
		return NextResponse.json({ success: true, mockedDate: null });
	}
	const parsedDate = new Date(body.date);
	if (Number.isNaN(parsedDate.getTime())) {
		return NextResponse.json({ error: "Invalid date" }, { status: 400 });
	}
	process.env.MOCK_DATE = parsedDate.toISOString();
	return NextResponse.json({
		success: true,
		mockedDate: process.env.MOCK_DATE,
	});
}

export function DELETE(request: Request) {
	if (!isDevLocalhost(request)) {
		return new NextResponse("Forbidden", { status: 403 });
	}
	delete process.env.MOCK_DATE;
	return NextResponse.json({ success: true, mockedDate: null });
}
