import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Browser } from "@playwright/test";

/** Keep original task/pause records without timeline layout instrumentation.
 * Detailed timeline recording measurably adds layout work to qualification;
 * the separate failure replay owns that recording and its CPU profile.
 * Start before navigation so recording adds no setup wait before the input.
 */
export async function startTurnQualificationTrace(browser: Browser) {
	const client = await browser.newBrowserCDPSession();
	const complete = new Promise<{ stream?: string }>((resolve) =>
		client.once("Tracing.tracingComplete", resolve),
	);
	try {
		await client.send("Tracing.start", {
			categories: "toplevel,blink.user_timing",
			transferMode: "ReturnAsStream",
		});
	} catch (error) {
		await client.detach();
		throw error;
	}
	let finished = false;
	return {
		async finish(path?: string) {
			if (finished) return;
			finished = true;
			try {
				await client.send("Tracing.end");
				const { stream } = await complete;
				if (!stream) throw new Error("Original turn trace stream missing");
				try {
					if (path) {
						const chunks: Buffer[] = [];
						for (;;) {
							const chunk = await client.send("IO.read", { handle: stream });
							chunks.push(
								Buffer.from(
									chunk.data,
									chunk.base64Encoded ? "base64" : "utf8",
								),
							);
							if (chunk.eof) break;
						}
						await mkdir(dirname(path), { recursive: true });
						await writeFile(path, Buffer.concat(chunks));
					}
				} finally {
					await client.send("IO.close", { handle: stream });
				}
			} finally {
				await client.detach();
			}
		},
	};
}
