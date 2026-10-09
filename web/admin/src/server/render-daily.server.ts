import "@tanstack/react-start/server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import type { BulletinArtifacts, BulletinInput } from "~/lib/daily-bulletin";

export async function renderDailyBulletin(
	input: BulletinInput,
): Promise<BulletinArtifacts> {
	const lambdaName = process.env.BULLETIN_LAMBDA_NAME;
	if (lambdaName || process.env.NODE_ENV === "production") {
		const { InvokeCommand, LambdaClient } = await import(
			"@aws-sdk/client-lambda"
		);
		const client = new LambdaClient({
			region: process.env.AWS_REGION || "il-central-1",
			maxAttempts: 1,
		});
		const result = await client.send(
			new InvokeCommand({
				FunctionName: lambdaName || "bible-on-site-bulletin",
				Payload: Buffer.from(
					JSON.stringify({
						version: "2.0",
						routeKey: "POST /api/preview-daily",
						rawPath: "/api/preview-daily",
						rawQueryString: "",
						headers: { "content-type": "application/json" },
						requestContext: {
							http: {
								method: "POST",
								path: "/api/preview-daily",
								sourceIp: "127.0.0.1",
							},
						},
						body: JSON.stringify(input),
						isBase64Encoded: false,
					}),
				),
			}),
			{ abortSignal: AbortSignal.timeout(35_000) },
		);
		if (result.FunctionError || !result.Payload)
			throw new Error("יצירת העלון נכשלה");
		const response = JSON.parse(Buffer.from(result.Payload).toString("utf8"));
		if (response.statusCode !== 200) throw new Error("יצירת העלון נכשלה");
		const body = response.isBase64Encoded
			? Buffer.from(response.body, "base64").toString("utf8")
			: response.body;
		return checkArtifacts(JSON.parse(body));
	}
	const binary =
		process.env.BULLETIN_BINARY_PATH ||
		path.resolve(
			"../bulletin/target/debug",
			process.platform === "win32" ? "bulletin.exe" : "bulletin",
		);
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn(binary, ["--daily-preview"], {
			timeout: 35_000,
			windowsHide: true,
		});
		const chunks: Buffer[] = [];
		let size = 0;
		child.stdout.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > 16 * 1024 * 1024) {
				child.kill();
				reject(new Error("העלון גדול מדי"));
			} else chunks.push(chunk);
		});
		child.stderr.resume();
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve(Buffer.concat(chunks).toString("utf8"))
				: reject(new Error("יצירת העלון נכשלה")),
		);
		child.stdin.on("error", reject);
		child.stdin.end(JSON.stringify(input));
	});
	return checkArtifacts(JSON.parse(output));
}

function checkArtifacts(value: BulletinArtifacts): BulletinArtifacts {
	if (
		!value ||
		typeof value.subject !== "string" ||
		typeof value.source !== "string" ||
		typeof value.emailHtml !== "string" ||
		typeof value.filename !== "string" ||
		typeof value.pdfBase64 !== "string" ||
		!Buffer.from(value.pdfBase64, "base64")
			.subarray(0, 5)
			.equals(Buffer.from("%PDF-"))
	) {
		throw new Error("יצירת העלון נכשלה");
	}
	return value;
}
