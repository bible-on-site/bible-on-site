import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	type ApprovalArticle,
	bulletinApprovalSql,
	planBulletinApprovals,
} from "~/server/bulletin-approval-plan";

const schema = `bulletin_approval_${randomBytes(10).toString("hex")}`;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
let admin: Connection;
let configured: URL;
let created = false;
const articles: ApprovalArticle[] = [
	{ id: 1, name: "מאמר", content: "<p>תוכן כתוב</p>", distributable: 0 },
	{
		id: 2,
		name: "שיעור",
		content: '<h1>שיעור</h1><audio src="lesson.opus"></audio>',
		distributable: 0,
	},
	{ id: 3, name: "מאמר מאושר", content: "<p>רעיון כתוב</p>", distributable: 1 },
	{
		id: 4,
		name: "שיעור שאושר בטעות",
		content: '<video src="lesson.webm"></video>',
		distributable: 1,
	},
];

/** Run the same isolated parser helpers as the existing native migration suite. */
function deploymentStatements(sql: string): string[] {
	const code = `
import ast, hashlib, json, os, pathlib, re, sys, zipfile
archive = os.environ.get("BULLETIN_MYSQL_LAMBDA_ZIP")
if archive:
    content = pathlib.Path(archive).read_bytes()
    expected = os.environ.get("BULLETIN_MYSQL_LAMBDA_SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected) or hashlib.sha256(content).hexdigest() != expected:
        raise ValueError("Deployment archive checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        source = bundle.read("index.py").decode("utf-8")
else:
    source = (pathlib.Path(sys.argv[1]) / "docs/aws/cloudformation/data-deploy/data-deploy-lambda.py").read_text(encoding="utf-8")
tree = ast.parse(source)
names = {"find_statement_end", "_should_execute", "parse_statements", "preprocess_sql"}
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
if {node.name for node in helpers} != names:
    raise ValueError("Required deployment SQL helpers are missing")
namespace = {"re": re}
exec(compile(ast.Module(body=helpers, type_ignores=[]), "sql-parser-helpers", "exec"), namespace)
print(json.dumps(namespace["parse_statements"](namespace["preprocess_sql"](sys.stdin.read()))))
`;
	return JSON.parse(
		execFileSync(process.env.PYTHON ?? "python", ["-c", code, root], {
			input: sql,
			encoding: "utf8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}),
	);
}

async function apply(sql: string): Promise<void> {
	const connection = await mysql.createConnection({
		host: configured.hostname,
		port: 3306,
		user: decodeURIComponent(configured.username),
		password: decodeURIComponent(configured.password),
		database: schema,
	});
	try {
		for (const statement of deploymentStatements(sql))
			await connection.query(statement); // nosemgrep: node-mysql-sqli -- generated SQL is validated by the approval planner and the deployment parser
	} finally {
		// Mirrors Lambda connection teardown: an aborted transaction rolls back.
		await connection.end();
	}
}

async function snapshot(): Promise<RowDataPacket[]> {
	const [rows] = await admin.query<RowDataPacket[]>(
		"SELECT * FROM tanah_article ORDER BY id",
	);
	return rows;
}

beforeAll(async () => {
	const value = process.env.BULLETIN_MYSQL_TEST_DB_URL;
	if (!value)
		throw new Error(
			"Set BULLETIN_MYSQL_TEST_DB_URL to an authorized loopback MySQL account",
		);
	configured = new URL(value);
	if (
		configured.protocol !== "mysql:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname) ||
		Number(configured.port || 3306) !== 3306 ||
		!/^bulletin_approval_[a-f0-9]{20}$/.test(schema)
	)
		throw new Error(
			"Native bulletin tests require loopback MySQL on port 3306",
		);
	admin = await mysql.createConnection({
		host: configured.hostname,
		port: 3306,
		user: decodeURIComponent(configured.username),
		password: decodeURIComponent(configured.password),
	});
	await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
	created = true;
	await admin.changeUser({ database: schema });
	await admin.query(
		"CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY,name VARCHAR(700),content MEDIUMTEXT,distributable BOOLEAN NOT NULL,untouched VARCHAR(100) NOT NULL DEFAULT 'retain') ENGINE=InnoDB",
	);
});

beforeEach(async () => {
	await admin.query("DELETE FROM tanah_article");
	for (const article of articles)
		await admin.execute(
			"INSERT INTO tanah_article (id,name,content,distributable) VALUES (?,?,?,?)",
			[article.id, article.name, article.content, article.distributable],
		);
});

afterAll(async () => {
	if (created) await admin.query(`DROP DATABASE \`${schema}\``);
	await admin?.end();
});

describe("guarded bulletin approvals through the database deployment parser", () => {
	it("changes only eligibility, supports guarded rollback, and preserves every other column", async () => {
		const before = await snapshot();
		const plan = planBulletinApprovals(articles);
		await apply(bulletinApprovalSql(plan.changes));
		expect(await snapshot()).toEqual(
			before.map((row) => ({
				...row,
				distributable: row.id === 1 || row.id === 3 ? 1 : 0,
			})),
		);
		await apply(bulletinApprovalSql(plan.changes, true));
		expect(await snapshot()).toEqual(before);
	});
	it("aborts without changing flags when article content changed after planning", async () => {
		const plan = planBulletinApprovals(articles);
		await admin.execute("UPDATE tanah_article SET content=? WHERE id=1", [
			"<p>תוכן חדש</p>",
		]);
		const before = await snapshot();
		await expect(apply(bulletinApprovalSql(plan.changes))).rejects.toThrow();
		expect(await snapshot()).toEqual(before);
	});
	it("aborts when a planned flag changed and never reapplies a completed operation", async () => {
		const plan = planBulletinApprovals(articles);
		await admin.query("UPDATE tanah_article SET distributable=1 WHERE id=1");
		const changed = await snapshot();
		await expect(apply(bulletinApprovalSql(plan.changes))).rejects.toThrow();
		expect(await snapshot()).toEqual(changed);
		await admin.query("UPDATE tanah_article SET distributable=0 WHERE id=1");
		await apply(bulletinApprovalSql(plan.changes));
		const applied = await snapshot();
		await expect(apply(bulletinApprovalSql(plan.changes))).rejects.toThrow();
		expect(await snapshot()).toEqual(applied);
	});
});
