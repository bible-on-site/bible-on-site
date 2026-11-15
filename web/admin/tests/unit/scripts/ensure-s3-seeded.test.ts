import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

const execFileAsync = promisify(execFile);
const script = join(process.cwd(), "scripts", "ensure-s3-seeded.mjs");

// The script decides by shelling out to `cargo make s3-populate-dev` without a
// shell, so the PATH stub must be a real executable: a ~20-line Rust binary
// (compiled once per run) that drops a marker instead of building. A stub HTTP
// server answers ListObjectsV2 so the whole matrix is exercised without Docker
// or a real release build.

function listXml(keys: string[]): string {
	const contents = keys
		.map(
			(key) =>
				"<Contents><Key>" +
				key +
				"</Key><LastModified>2024-01-01T00:00:00.000Z</LastModified><Size>1</Size></Contents>",
		)
		.join("");
	return [
		'<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
		"<KeyCount>",
		String(keys.length),
		"</KeyCount><MaxKeys>1</MaxKeys><IsTruncated>false</IsTruncated>",
		contents,
		"</ListBucketResult>",
	].join("");
}

describe("ensure-s3-seeded", () => {
	let dir: string;
	let server: Server;
	let endpoint: string;
	let populated: () => boolean;
	let mode: "objects" | "empty" | "missing";
	let stubDir: string;

	beforeAll(() => {
		stubDir = mkdtempSync(join(tmpdir(), "s3-seeded-cargo-"));
		writeFileSync(
			join(stubDir, "cargo_stub.rs"),
			`fn main() {
	let m = std::env::var("POPULATE_MARKER").expect("POPULATE_MARKER");
	std::fs::write(m, "ok").expect("marker");
}
`,
		);
		const out = join(
			stubDir,
			process.platform === "win32" ? "cargo.exe" : "cargo",
		);
		const build = spawnSync(
			"rustc",
			[join(stubDir, "cargo_stub.rs"), "-o", out],
			{ encoding: "utf-8" },
		);
		if (build.status !== 0)
			throw new Error(`cargo stub build failed: ${build.stderr}`);
	}, 60_000);

	beforeEach(async () => {
		dir = mkdtempSync(join(tmpdir(), "s3-seeded-"));
		mode = "objects";
		const marker = join(dir, "populated.marker");
		process.env.POPULATE_MARKER = marker;
		populated = () => existsSync(marker);

		server = createServer((_req, res) => {
			if (mode === "missing") {
				res.writeHead(404, { "content-type": "application/xml" });
				res.end(
					`<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchBucket</Code></Error>`,
				);
				return;
			}
			res.writeHead(200, { "content-type": "application/xml" });
			res.end(listXml(mode === "objects" ? ["seeded.png"] : []));
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (typeof address !== "object" || address === null)
			throw new Error("stub server has no address");
		endpoint = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await new Promise((resolve) => server.close(resolve));
		rmSync(dir, { recursive: true, force: true });
	});

	afterAll(() => {
		rmSync(stubDir, { recursive: true, force: true });
	});

	function run(extraEnv: Record<string, string> = {}) {
		return execFileAsync(process.execPath, [script], {
			env: {
				...process.env,
				PATH: `${stubDir}${delimiter}${process.env.PATH}`,
				S3_ENDPOINT: endpoint,
				S3_BUCKET: "bible-on-site-assets-dev",
				S3_REGION: "us-east-1",
				S3_ACCESS_KEY_ID: "test",
				S3_SECRET_ACCESS_KEY: "test_1234",
				...extraEnv,
			},
		});
	}

	it("skips the populator when the dev bucket already holds objects", async () => {
		const { stdout } = await run();
		expect(stdout).toContain("already holds objects");
		expect(populated()).toBe(false);
	}, 30_000);

	it("runs the populator when the dev bucket is empty", async () => {
		mode = "empty";
		await run();
		expect(populated()).toBe(true);
	}, 30_000);

	it("runs the populator when the dev bucket is missing", async () => {
		mode = "missing";
		await run();
		expect(populated()).toBe(true);
	}, 30_000);

	it("runs the populator when the endpoint is unreachable", async () => {
		await run({ S3_ENDPOINT: "http://127.0.0.1:1" });
		expect(populated()).toBe(true);
	}, 30_000);
});
