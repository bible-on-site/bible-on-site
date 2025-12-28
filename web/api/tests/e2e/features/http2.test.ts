import * as http2 from "node:http2";
import { expect, test } from "@playwright/test";

const HOST = "127.0.0.1";
const PORT = 3003;

test.describe("HTTP/2", () => {
	test("supports HTTP/2 cleartext (h2c) connections", async () => {
		const responseData = await new Promise<{
			statusCode: number;
			headers: Record<string, string>;
			body: string;
		}>((resolve, reject) => {
			const client = http2.connect(`http://${HOST}:${PORT}`);

			client.on("error", (err) => {
				client.close();
				reject(err);
			});

			const requestBody = JSON.stringify({
				operationName: null,
				variables: {},
				query: "{\n  sefarim {\n    id\n    name\n  }\n}\n",
			});

			const req = client.request({
				":method": "POST",
				":path": "/api/graphql",
				"content-type": "application/json",
				"content-length": Buffer.byteLength(requestBody),
			});

			let data = "";
			let headers: Record<string, string> = {};

			req.on("response", (hdrs) => {
				headers = hdrs as Record<string, string>;
			});

			req.on("data", (chunk) => {
				data += chunk;
			});

			req.on("end", () => {
				client.close();
				resolve({
					statusCode: Number.parseInt(headers[":status"] || "0", 10),
					headers,
					body: data,
				});
			});

			req.on("error", (err) => {
				client.close();
				reject(err);
			});

			req.write(requestBody);
			req.end();
		});

		expect(responseData.statusCode).toBe(200);

		const body = JSON.parse(responseData.body);
		expect(body.data.sefarim).toBeDefined();
		expect(body.data.sefarim.length).toBeGreaterThan(0);
	});
});
