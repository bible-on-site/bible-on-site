import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const DATABASE = "article_fingerprint_test";
const MYSQL_IMAGES = new Map([
	["8.4.9", "mysql:8.4.9"],
	["8.4.13", "mysql:8.4.13"],
]);

const SEED = `
DROP TABLE IF EXISTS article_search_doc, tanah_article;

CREATE TABLE tanah_article (
    id MEDIUMINT NOT NULL PRIMARY KEY,
    perek_id SMALLINT NOT NULL,
    author_id SMALLINT NOT NULL,
    abstract VARCHAR(10000),
    name VARCHAR(700) NOT NULL,
    content MEDIUMTEXT,
    content_hash BINARY(16) GENERATED ALWAYS AS (
        UNHEX(MD5(CONCAT_WS(X'01', IFNULL(name, ''), IFNULL(abstract, ''),
            IFNULL(content, ''), perek_id, author_id)))
    ) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3;

CREATE TABLE article_search_doc (
    article_id MEDIUMINT NOT NULL PRIMARY KEY,
    model_epoch INT NOT NULL,
    content_hash BINARY(16) NOT NULL,
    plain_len INT NOT NULL,
    vector BLOB NOT NULL,
    terms MEDIUMBLOB NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO tanah_article (id, perek_id, author_id, abstract, name, content)
VALUES
    (1, 11, 7, NULL, 'שָׁלוֹם', 'תוכן'),
    (2, 12, 8, 'Abstract', 'Edited article', 'Original content'),
    (3, 13, 9, '', 'Article without a document', NULL);

INSERT INTO article_search_doc
    (article_id, model_epoch, content_hash, plain_len, vector, terms, updated_at)
SELECT id, id + 4, content_hash, id + 100, X'00c1ff', X'12ee00', '2025-01-02 03:04:05'
FROM tanah_article WHERE id IN (1, 2);

INSERT INTO article_search_doc VALUES
    (4, 9, X'0123456789abcdef0123456789abcdef', 121, X'00a1ff', X'13ff00',
        '2025-01-03 03:04:05');

UPDATE tanah_article SET content = 'Current content' WHERE id = 2;
`;

const ARTICLE_FIELDS = `
SELECT id, perek_id, author_id, HEX(abstract), HEX(name), HEX(content)
FROM tanah_article ORDER BY id;
`;
const ARTICLE_HASHES =
	"SELECT id, HEX(content_hash) FROM tanah_article ORDER BY id;";
const SEARCH_DOCUMENTS = `
SELECT article_id, HEX(content_hash), model_epoch, plain_len, HEX(vector),
    HEX(terms), updated_at
FROM article_search_doc ORDER BY article_id;
`;
const INTERRUPT_REPAIR = `
CREATE TRIGGER interrupt_fingerprint_repair BEFORE UPDATE ON article_search_doc
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fingerprint fixture interrupted repair';
`;

function docker(args, { input, allowFailure = false } = {}) {
	const result = spawnSync("docker", args, {
		encoding: "utf8",
		input,
		shell: false,
		windowsHide: true,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0 && !allowFailure) {
		throw new Error(
			`Docker ${args[0]} failed (${result.status ?? result.signal})\n${result.stderr}`,
		);
	}
	return result;
}

async function waitForMysql(container) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		// The initialization server only listens on its Unix socket.
		const probe = docker(
			["exec", container, "mysqladmin", "--protocol=tcp", "ping"],
			{ allowFailure: true },
		);
		if (probe.status === 0) {
			return;
		}
		await delay(250);
	}
	const logs = docker(["logs", container], { allowFailure: true });
	throw new Error(
		`The disposable MySQL server did not finish starting\n${logs.stdout}${logs.stderr}`,
	);
}

function mysql(container, sql, { allowFailure = false } = {}) {
	return docker(
		[
			"exec",
			"-i",
			container,
			"mysql",
			"--protocol=socket",
			"--batch",
			"--raw",
			"--skip-column-names",
			"--default-character-set=utf8mb4",
			`--database=${DATABASE}`,
		],
		{ input: sql, allowFailure },
	);
}

function rows(container, sql) {
	return mysql(container, sql)
		.stdout.trimEnd()
		.split(/\r?\n/)
		.map((line) => line.split("\t"));
}

function expectedDigest(...fields) {
	return createHash("sha256")
		.update(fields.join("\x01"), "utf8")
		.digest("hex")
		.slice(0, 32)
		.toUpperCase();
}

const EXPECTED_HASHES = [
	["1", expectedDigest("שָׁלוֹם", "", "תוכן", "11", "7")],
	[
		"2",
		expectedDigest("Edited article", "Abstract", "Current content", "12", "8"),
	],
	["3", expectedDigest("Article without a document", "", "", "13", "9")],
];

function seedLegacyFixture(container) {
	mysql(container, SEED);
	const articles = rows(container, ARTICLE_FIELDS);
	const legacyHashes = new Map(rows(container, ARTICLE_HASHES));
	const originalDocs = rows(container, SEARCH_DOCUMENTS);
	const [fresh, stale, orphan] = originalDocs;
	assert.deepEqual(
		fresh.slice(0, 2),
		["1", legacyHashes.get("1")],
		"fresh fixture",
	);
	assert.equal(stale[0], "2", "stale fixture article");
	assert.notEqual(stale[1], legacyHashes.get("2"), "stale fixture hash");
	assert.equal(orphan[0], "4", "orphan fixture");
	return {
		articles,
		originalDocs,
		migratedDocs: [
			["1", EXPECTED_HASHES[0][1], ...fresh.slice(2)],
			stale,
			orphan,
		],
	};
}

function verifyMigration(container, fixture, expectedDocs, stage) {
	assert.deepEqual(
		rows(container, ARTICLE_FIELDS),
		fixture.articles,
		`${stage} source fields`,
	);
	assert.deepEqual(
		rows(container, ARTICLE_HASHES),
		EXPECTED_HASHES,
		`${stage} source hashes`,
	);
	assert.deepEqual(
		rows(container, SEARCH_DOCUMENTS),
		expectedDocs,
		`${stage} search documents`,
	);
}

function exerciseMigration(container) {
	const migration = readFileSync(
		new URL("./manual/mysql-97-article-fingerprint.sql", import.meta.url),
	);
	const fixture = seedLegacyFixture(container);
	for (const run of [1, 2]) {
		mysql(container, migration);
		verifyMigration(container, fixture, fixture.migratedDocs, `run ${run}`);
	}

	mysql(
		container,
		"UPDATE tanah_article SET abstract = 'Revised' WHERE id = 1;",
	);
	assert.deepEqual(
		rows(container, ARTICLE_HASHES),
		[
			["1", expectedDigest("שָׁלוֹם", "Revised", "תוכן", "11", "7")],
			...EXPECTED_HASHES.slice(1),
		],
		"generated fingerprints track edits",
	);
	assert.deepEqual(
		rows(container, SEARCH_DOCUMENTS),
		fixture.migratedDocs,
		"the search document becomes stale after its source changes",
	);

	const interrupted = seedLegacyFixture(container);
	mysql(container, INTERRUPT_REPAIR);
	const failure = mysql(container, migration, { allowFailure: true });
	assert.equal(failure.status, 1, "mysql exits on the injected repair failure");
	assert.match(
		failure.stderr,
		/ERROR 1644 \(45000\).*fingerprint fixture interrupted repair/,
	);
	// The DDL has committed even though the document repair statement failed.
	verifyMigration(
		container,
		interrupted,
		interrupted.originalDocs,
		"interrupted",
	);

	mysql(container, "DROP TRIGGER interrupt_fingerprint_repair;");
	mysql(container, migration);
	verifyMigration(
		container,
		interrupted,
		interrupted.migratedDocs,
		"recovered",
	);
}

const { values } = parseArgs({
	options: { "mysql-tag": { type: "string", default: "8.4.9" } },
});
const version = values["mysql-tag"];
const image = MYSQL_IMAGES.get(version);
assert.ok(image, "expected --mysql-tag 8.4.9 or 8.4.13");

const container = docker([
	"run",
	"--detach",
	"--rm",
	"--network",
	"none",
	"--env",
	"MYSQL_ALLOW_EMPTY_PASSWORD=yes",
	"--env",
	`MYSQL_DATABASE=${DATABASE}`,
	image,
]).stdout.trim();
assert.match(
	container,
	/^[0-9a-f]{64}$/u,
	"expected the disposable Docker container ID",
);
try {
	await waitForMysql(container);
	assert.equal(mysql(container, "SELECT VERSION();").stdout.trim(), version);
	exerciseMigration(container);
	console.log(
		`MySQL ${version} fingerprint migration, rerun, and interrupted recovery passed`,
	);
} finally {
	docker(["stop", container]);
}
