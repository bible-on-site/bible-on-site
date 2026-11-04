import { NextResponse } from "next/server";
import { isJoinChannel, resolveJoinDestination } from "@/lib/bulletin-join";

export const dynamic = "force-dynamic";

const CHANNEL_NAMES = {
	whatsapp: "ווטסאפ",
	telegram: "טלגרם",
} as const;

const NO_STORE = { "Cache-Control": "no-store" };

function unavailableHtml(channelName: string): string {
	return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>הצטרפות לעלון היומי | תנ&quot;ך על הפרק</title>
<style>
body { margin: 0; font-family: Tahoma, Arial, sans-serif; background: #f5f9fa; color: #1d3a44; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
main { max-width: 32em; padding: 2em; text-align: center; }
h1 { font-size: 1.6em; }
a { color: #28758a; }
</style>
</head>
<body>
<main>
<h1>הצטרפות לעלון היומי</h1>
<p>קישור ההצטרפות ב${channelName} אינו זמין כרגע. נסו שוב מאוחר יותר.</p>
<p><a href="/dailyBulletin">אפשרויות הצטרפות נוספות לעלון היומי</a></p>
<p><a href="/contact">יצירת קשר</a></p>
</main>
</body>
</html>`;
}

function unavailable(
	channel: keyof typeof CHANNEL_NAMES,
	headOnly: boolean,
): NextResponse {
	return new NextResponse(
		headOnly ? null : unavailableHtml(CHANNEL_NAMES[channel]),
		{
			status: 503,
			headers: { ...NO_STORE, "content-type": "text/html; charset=utf-8" },
		},
	);
}

async function respond(
	channel: string,
	headOnly: boolean,
): Promise<NextResponse> {
	if (!isJoinChannel(channel)) {
		return new NextResponse(headOnly ? null : "Not found", {
			status: 404,
			headers: NO_STORE,
		});
	}
	let destination: string | null;
	try {
		destination = await resolveJoinDestination(channel);
	} catch {
		// A persistence failure is an unavailable state, not a dead end.
		console.error("Bulletin join destination lookup failed");
		destination = null;
	}
	if (destination === null) return unavailable(channel, headOnly);
	return headOnly
		? new NextResponse(null, {
				status: 307,
				headers: { ...NO_STORE, location: destination },
			})
		: NextResponse.redirect(destination, { status: 307, headers: NO_STORE });
}

type Props = { params: Promise<{ channel: string }> };

export async function GET(_request: Request, { params }: Props) {
	return respond((await params).channel, false);
}

export async function HEAD(_request: Request, { params }: Props) {
	return respond((await params).channel, true);
}
