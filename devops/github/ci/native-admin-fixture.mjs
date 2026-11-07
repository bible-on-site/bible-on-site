// Own the entire database server: the document probe must observe a real row.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// One synthetic row keeps the document-path probe honest: the auth boundary
// must redirect a recorded hash exactly like an unrecorded one, so the URLs
// below are the single source of truth for the inserted row and the probe.
export const FIXTURE_BULLETIN = Object.freeze({
	date: "2001-02-03",
	filename: "native-fixture.pdf",
	pdfText: "%PDF-1.4\n% isolated native admin fixture\n",
});
const sha256 = (text) =>
	createHash("sha256").update(text, "utf8").digest("hex");
export const BULLETIN_DOCUMENT_PATH = `/api/bulletin-documents/${FIXTURE_BULLETIN.date}/${sha256(FIXTURE_BULLETIN.pdfText)}.pdf`;
// A validly shaped but unrecorded hash proves the hit came from the row match.
export const BULLETIN_MISSING_PATH = `/api/bulletin-documents/${FIXTURE_BULLETIN.date}/${"0".repeat(64)}.pdf`;

export async function createAdminFixture(docker, { arch, now, sleep }) {
	const identity = `native-admin-fixture-${randomUUID()}`;
	const network = `${identity}-network`;
	const name = `${identity}-mysql`;
	const password = randomBytes(24).toString("hex");
	let networkCreated = false;
	let containerCreated = false;
	const sql = (input) =>
		docker(
			[
				"exec",
				"--interactive",
				"--env",
				`MYSQL_PWD=${password}`,
				name,
				"mysql",
				"--user=root",
				"--host=127.0.0.1",
				"--batch",
				"--skip-column-names",
				"native_image_smoke",
			],
			{ input },
		);
	const cleanup = () => {
		const errors = [];
		if (containerCreated) {
			try {
				docker(["rm", "--force", "--volumes", name]);
			} catch (error) {
				errors.push(error);
			}
		}
		if (networkCreated) {
			try {
				docker(["network", "rm", network]);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length)
			throw new AggregateError(
				errors,
				"Could not clean the owned admin fixture",
			);
	};
	try {
		// No host ports, credentials from the environment, or outbound network route.
		networkCreated = true;
		docker(["network", "create", "--internal", network]);
		containerCreated = true;
		docker([
			"run",
			"--detach",
			"--name",
			name,
			"--platform",
			`linux/${arch}`,
			"--network",
			network,
			"--cpus",
			"1",
			"--memory",
			"768m",
			"--env",
			`MYSQL_ROOT_PASSWORD=${password}`,
			"--env",
			"MYSQL_ROOT_HOST=%",
			"--env",
			"MYSQL_DATABASE=native_image_smoke",
			"mysql:8.4",
		]);
		const deadline = now() + 30_000;
		let lastError;
		while (true) {
			try {
				assert.equal(sql("SELECT 1;"), "1");
				break;
			} catch (error) {
				lastError = error;
				assert.equal(
					docker(["inspect", "--format", "{{.State.Running}}", name]),
					"true",
					"Isolated MySQL exited",
				);
				if (now() >= deadline)
					throw new Error("Isolated MySQL did not initialize within 30000 ms", {
						cause: lastError,
					});
				await sleep(250);
			}
		}
		sql(
			readFileSync(new URL("./native-admin-fixture.sql", import.meta.url), "utf8"),
		);
		const pdf = Buffer.from(FIXTURE_BULLETIN.pdfText, "utf8").toString("hex");
		sql(
			`INSERT INTO tanah_daily_bulletin (bulletin_date, perek_id, article_id, input_json, subject, source, email_html, pdf_data, filename) VALUES ('${FIXTURE_BULLETIN.date}', 1, NULL, '{}', 'Isolated native fixture', 'native-smoke', '<p>fixture</p>', X'${pdf}', '${FIXTURE_BULLETIN.filename}');`,
		);
		return {
			network,
			sql,
			cleanup,
			databaseUrl: `mysql://root:${password}@${name}:3306/native_image_smoke`,
		};
	} catch (error) {
		try {
			cleanup();
		} catch (cleanupError) {
			console.error(cleanupError);
		}
		throw error;
	}
}
