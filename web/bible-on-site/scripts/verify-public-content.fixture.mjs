import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal origin for exercising verify-public-content.mjs end to end in CI,
// matching the deployment job's install layout (devops deps via NODE_PATH,
// no website node_modules). Serves just enough real markup for the
// verifier's content assertions. (#2372)

const pages = {
	"/api/health/ready": {
		type: "application/json",
		body: '{"status":"ready","content":{"authorCount":1}}',
	},
	"/929/authors": '<a href="/929/authors/one">One</a>',
	"/929/1": '<a href="/929/1/4">Article</a>',
	"/929/authors/one": '<a href="/929/1/4">Article</a>',
	"/929/1/4": "<h1>Public article</h1>",
};

export function startFixture(port = 0) {
	const server = createServer((request, response) => {
		const route = new URL(request.url, "http://fixture").pathname;
		const page = pages[route];
		const body = typeof page === "string" ? page : page?.body;
		response.writeHead(body === undefined ? 404 : 200, {
			"content-type": typeof page === "object" ? page.type : "text/html",
		});
		response.end(body ?? "not found");
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () =>
			resolve({ server, port: server.address().port }),
		);
	});
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const { port } = await startFixture(Number(process.argv[2] ?? 0));
	console.log(`verify-public-content fixture listening on ${port}`);
}
