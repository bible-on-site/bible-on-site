/** Small JSON API bodies; a `PushSubscription.toJSON()` is well under 1 KB. */
export const MAX_JSON_BODY_BYTES = 4 * 1024;

export type BoundedJson =
	| { status: "empty" }
	| { status: "invalid" }
	| { status: "unreadable" }
	| { status: "parsed"; value: unknown };

/**
 * Reads a JSON body with the size cap enforced while streaming, so an
 * untruthful or missing Content-Length cannot make the server buffer an
 * unbounded body.
 */
export async function readBoundedJson(
	request: Request,
	maxBytes: number,
): Promise<BoundedJson> {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > maxBytes) return { status: "invalid" };
	const body = request.body;
	if (!body) return { status: "empty" };
	const decoder = new TextDecoder();
	let text = "";
	let size = 0;
	try {
		const reader = body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				text += decoder.decode();
				break;
			}
			size += value.byteLength;
			if (size > maxBytes) {
				await reader.cancel();
				return { status: "invalid" };
			}
			text += decoder.decode(value, { stream: true });
		}
	} catch {
		return { status: "unreadable" };
	}
	if (text.length === 0) return { status: "empty" };
	try {
		return { status: "parsed", value: JSON.parse(text) };
	} catch {
		return { status: "invalid" };
	}
}
