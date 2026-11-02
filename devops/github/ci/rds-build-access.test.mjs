import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	cleanupAccess,
	cleanupCompletedBuild,
	completedBuildRun,
	databaseHost,
	grantAccess,
	runnerIpv4,
} from "./rds-build-access.mjs";

const nonce = "5c2c5bcd-0247-45de-a281-1296f2111fa1";
const ruleId = "sgr-0123456789abcdef0";

async function fixture(t) {
	const dir = mkdtempSync(join(tmpdir(), "rds-build-access-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const env = {
		AWS_REGION: "il-central-1",
		RDS_BUILD_ACCESS_ROLE: "arn:aws:iam::123456789012:role/ci",
		RDS_SECURITY_GROUP: "sg-0123456789abcdef0",
		GITHUB_RUN_ID: "1234",
		GITHUB_RUN_ATTEMPT: "2",
		GITHUB_JOB: "package",
		RDS_BUILD_ACCESS_LEASE: join(dir, "lease.json"),
	};
	const calls = [];
	let rules = [];
	const rule = () => ({
		GroupOwnerId: "123456789012",
		GroupId: env.RDS_SECURITY_GROUP,
		SecurityGroupRuleId: ruleId,
		IsEgress: false,
		IpProtocol: "tcp",
		FromPort: 3306,
		ToPort: 3306,
		CidrIpv4: "198.51.100.7/32",
		Tags: Object.entries({
			Source: "github-actions-build",
			RunId: "1234",
			RunAttempt: "2",
			Job: "package",
			BuildLease: nonce,
		}).map(([Key, Value]) => ({ Key, Value })),
	});
	const aws = async (args) => {
		calls.push(args);
		switch (args[1]) {
			case "get-caller-identity":
				return { Account: "123456789012" };
			case "authorize-security-group-ingress": {
				// The ownership journal must exist before the first AWS mutation.
				assert.equal(
					JSON.parse(readFileSync(env.RDS_BUILD_ACCESS_LEASE, "utf8")).nonce,
					nonce,
				);
				rules = [rule()];
				return { Return: true, SecurityGroupRules: structuredClone(rules) };
			}
			case "describe-security-group-rules":
				return { SecurityGroupRules: structuredClone(rules) };
			case "revoke-security-group-ingress":
				rules = [];
				return { Return: true };
			default:
				throw new Error(`Unexpected AWS command ${args[1]}`);
		}
	};
	return {
		env,
		calls,
		aws,
		rule,
		deps: { aws, publicIp: async () => "198.51.100.7\n", nonce: () => nonce },
		setRules(value) {
			rules = value;
		},
	};
}

test("creates one /32 TCP3306 rule and revokes only its captured ID after fresh ownership verification", async (t) => {
	const f = await fixture(t);
	const lease = await grantAccess(f.env, f.deps);
	assert.equal(lease.ruleId, ruleId);
	assert.equal(
		JSON.parse(readFileSync(f.env.RDS_BUILD_ACCESS_LEASE, "utf8")).ruleId,
		ruleId,
	);
	const grant = f.calls.find(
		(args) => args[1] === "authorize-security-group-ingress",
	);
	assert.equal(grant[grant.indexOf("--cidr") + 1], "198.51.100.7/32");
	assert.equal(grant[grant.indexOf("--port") + 1], "3306");
	assert.equal(grant[grant.indexOf("--protocol") + 1], "tcp");
	await cleanupAccess(f.env, f.deps);
	assert.deepEqual(
		f.calls.filter((args) => args[1] === "revoke-security-group-ingress"),
		[
			[
				"ec2",
				"revoke-security-group-ingress",
				"--group-id",
				f.env.RDS_SECURITY_GROUP,
				"--security-group-rule-ids",
				ruleId,
			],
		],
	);
	assert.equal(
		f.calls.filter((args) => args[1] === "describe-security-group-rules")
			.length,
		2,
	);
});

test("duplicate grant failure never revokes an existing rule for the runner's CIDR", async (t) => {
	const f = await fixture(t);
	const aws = async (args) => {
		if (args[1] === "authorize-security-group-ingress")
			throw new Error("InvalidPermission.Duplicate");
		if (args[1] === "describe-security-group-rules") {
			assert.ok(args.includes(`Name=tag:BuildLease,Values=${nonce}`));
			return { SecurityGroupRules: [] }; // Existing rule has no new random ownership tag.
		}
		return f.aws(args);
	};
	await assert.rejects(grantAccess(f.env, { ...f.deps, aws }), /Duplicate/);
	await cleanupAccess(f.env, { aws });
	assert.ok(
		!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
	);
});

test("recovers an owned rule when the grant response is lost, retaining the original failure", async (t) => {
	const f = await fixture(t);
	const aws = async (args) => {
		const result = await f.aws(args);
		if (args[1] === "authorize-security-group-ingress")
			throw new Error("response lost");
		return result;
	};
	await assert.rejects(grantAccess(f.env, { ...f.deps, aws }), /response lost/);
	assert.equal(
		JSON.parse(readFileSync(f.env.RDS_BUILD_ACCESS_LEASE, "utf8")).ruleId,
		undefined,
	);
	await cleanupAccess(f.env, { aws });
	assert.equal(
		f.calls.filter((args) => args[1] === "revoke-security-group-ingress")
			.length,
		1,
	);
});

test("a failed receipt write preserves the ownership journal for cleanup", async (t) => {
	const f = await fixture(t);
	writeFileSync(`${f.env.RDS_BUILD_ACCESS_LEASE}.receipt`, "occupied");
	await assert.rejects(grantAccess(f.env, f.deps), { code: "EEXIST" });
	assert.equal(
		JSON.parse(readFileSync(f.env.RDS_BUILD_ACCESS_LEASE, "utf8")).nonce,
		nonce,
	);
	await cleanupAccess(f.env, f.deps);
	assert.equal(
		f.calls.filter((args) => args[1] === "revoke-security-group-ingress")
			.length,
		1,
	);
});

test("cleanup without a grant journal makes no AWS call", async (t) => {
	const f = await fixture(t);
	await cleanupAccess(f.env, f.deps);
	assert.equal(f.calls.length, 0);
});

for (const [field, value] of Object.entries({
	GroupOwnerId: "111111111111",
	GroupId: "sg-11111111111111111",
	IsEgress: true,
	IpProtocol: "-1",
	FromPort: 0,
	ToPort: 65535,
	CidrIpv4: "0.0.0.0/0",
	SecurityGroupRuleId: "sgr-11111111111111111",
	Tags: [],
})) {
	test(`cleanup refuses a changed or unowned ${field}`, async (t) => {
		const f = await fixture(t);
		await grantAccess(f.env, f.deps);
		f.setRules([{ ...f.rule(), [field]: value }]);
		await assert.rejects(cleanupAccess(f.env, f.deps), /does not match/);
		assert.ok(
			!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
		);
	});
}

test("ambiguous ownership fails without deleting either rule", async (t) => {
	const f = await fixture(t);
	await grantAccess(f.env, f.deps);
	f.setRules([f.rule(), f.rule()]);
	await assert.rejects(cleanupAccess(f.env, f.deps), /Ambiguous/);
	assert.ok(
		!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
	);
});

test("a previously removed rule needs no further mutation", async (t) => {
	const f = await fixture(t);
	await grantAccess(f.env, f.deps);
	f.setRules([]);
	await cleanupAccess(f.env, f.deps);
	assert.ok(
		!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
	);
});

for (const ip of [
	"",
	"198.51.100.7/24",
	"198.51.100.7\n0.0.0.0",
	"$(touch /tmp/unsafe)",
	"::1",
	"256.1.1.1",
]) {
	test(`invalid IP ${JSON.stringify(ip)} cannot reach AWS`, async (t) => {
		const f = await fixture(t);
		await assert.rejects(
			grantAccess(f.env, { ...f.deps, publicIp: async () => ip }),
			/IPv4/,
		);
		assert.equal(f.calls.length, 0);
	});
}

test("wrong account or region cannot grant or revoke access", async (t) => {
	const f = await fixture(t);
	await assert.rejects(
		grantAccess({ ...f.env, AWS_REGION: "us-east-1" }, f.deps),
		/region/,
	);
	assert.equal(f.calls.length, 0);
	await assert.rejects(
		grantAccess(f.env, {
			...f.deps,
			aws: async () => ({ Account: "111111111111" }),
		}),
		/account/,
	);
	await grantAccess(f.env, f.deps);
	await assert.rejects(
		cleanupAccess(f.env, { aws: async () => ({ Account: "111111111111" }) }),
		/account/,
	);
	assert.ok(
		!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
	);
});

test("a stale journal from another run or attempt cannot revoke access", async (t) => {
	const f = await fixture(t);
	await grantAccess(f.env, f.deps);
	await assert.rejects(
		cleanupAccess({ ...f.env, GITHUB_RUN_ATTEMPT: "3" }, f.deps),
		/attempt mismatch/,
	);
	await assert.rejects(
		cleanupAccess({ ...f.env, GITHUB_RUN_ID: "5678" }, f.deps),
		/run mismatch/,
	);
	assert.ok(
		!f.calls.some((args) => args[1] === "revoke-security-group-ingress"),
	);
});

test("invalid configured deployment roles fail before IP lookup or AWS calls", async (t) => {
	const f = await fixture(t);
	for (const role of [
		undefined,
		"arn:aws:iam::111:role/ci",
		"arn:aws:sts::123456789012:role/ci",
		"arn:aws:iam::123456789012:user/ci",
		"arn:aws:iam::123456789012:role/",
	]) {
		await assert.rejects(
			grantAccess(
				{ ...f.env, RDS_BUILD_ACCESS_ROLE: role },
				{
					...f.deps,
					publicIp: async () => {
						throw new Error("IP lookup must not run");
					},
				},
			),
			/deployment role/,
		);
	}
	assert.equal(f.calls.length, 0);
});

test("malformed persisted ownership tokens and rule IDs cannot reach AWS", async (t) => {
	const f = await fixture(t);
	const lease = await grantAccess(f.env, f.deps);
	f.calls.length = 0;
	for (const changed of [
		{ nonce: "-".repeat(36) },
		{ nonce: "f".repeat(100000) },
		{ ruleId: "sgr-0123456789abcdefg" },
	]) {
		writeFileSync(
			f.env.RDS_BUILD_ACCESS_LEASE,
			JSON.stringify({ ...lease, ...changed }),
		);
		await assert.rejects(cleanupAccess(f.env, f.deps), /Invalid/);
	}
	assert.equal(f.calls.length, 0);
});

test("refuses to report cleanup success without AWS acknowledgement and empty readback", async (t) => {
	const f = await fixture(t);
	await grantAccess(f.env, f.deps);
	await assert.rejects(
		cleanupAccess(f.env, {
			aws: async (args) =>
				args[1] === "revoke-security-group-ingress"
					? { Return: false }
					: f.aws(args),
		}),
		/did not confirm/,
	);
	await assert.rejects(
		cleanupAccess(f.env, {
			aws: async (args) =>
				args[1] === "revoke-security-group-ingress"
					? { Return: true }
					: f.aws(args),
		}),
		/still present/,
	);
});

test("database credentials stay data and never become host shell code", () => {
	assert.equal(runnerIpv4("198.51.100.7\n"), "198.51.100.7");
	assert.equal(
		databaseHost("mysql://user:p%40%24%28bad%29@db.example.com:3306/tanah"),
		"db.example.com",
	);
	for (const value of [
		"not a URL",
		"https://db.example.com",
		"mysql://user:pass@-bad/tanah",
		"mysql://user:pass@db.example.com:1234/tanah",
		"mysql://user:pass@$(bad)/tanah",
	])
		assert.throws(() => databaseHost(value), /Invalid database/);
});

test("manifest replay passes the derived database URL as literal data", () => {
	const workflow = readFileSync(
		new URL("../../../.github/workflows/shared-dockerize.yml", import.meta.url),
		"utf8",
	).replace(/\r\n/g, "\n");
	const step = workflow
		.split("      - name: Replay the deploy manifest on the local dump\n")[1]
		?.split("      # --- End Local SSG database ---")[0];
	assert.ok(step, "The real manifest replay step must exist");
	assert.match(
		step,
		/LOCAL_DB_URL: \$\{\{ steps\.dump_prod\.outputs\.local_db_url \}\}/,
	);
	const marker = "        run: |\n";
	const start = step.indexOf(marker);
	assert.notEqual(start, -1, "Manifest replay must have a shell command");
	const script = step
		.slice(start + marker.length)
		.split("\n")
		.map((line) => line.replace(/^ {10}/, ""))
		.join("\n");
	const url = "mysql://root:test_123@127.0.0.1:3306/db$(unsafe)";
	const shell =
		process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
	const result = spawnSync(
		shell,
		[
			"--noprofile",
			"--norc",
			"-e",
			"-c",
			String.raw`python3() { printf '%s\0' "$@"; }; unsafe() { printf INJECTION_EXECUTED; };` +
				"\n" +
				script,
		],
		{
			encoding: "utf8",
			timeout: 5000,
			env: { ...process.env, LOCAL_DB_URL: url },
		},
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.stdout.split("\0").filter(Boolean), [
		"-m",
		"pip",
		"install",
		"--quiet",
		"pymysql",
		"devops/deploy/data-deploy/validate_lambda_parser.py",
		"--db",
		url,
	]);
});

function productionDumpScript() {
	const workflow = readFileSync(
		new URL("../../../.github/workflows/shared-dockerize.yml", import.meta.url),
		"utf8",
	).replace(/\r\n/g, "\n");
	const step = workflow
		.split("      - name: Dump production data into local MySQL\n")[1]
		?.split("      - name: Replay the deploy manifest on the local dump\n")[0];
	assert.ok(step, "The real production dump step must exist");
	const marker = "        run: |\n";
	assert.ok(step.includes(marker));
	return step
		.slice(step.indexOf(marker) + marker.length)
		.split("\n")
		.map((line) => line.replace(/^ {10}/, ""))
		.join("\n");
}

function dumpFixture(t, failures = {}) {
	const dir = mkdtempSync(join(tmpdir(), "rds-tls-fixture "));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const env = {
		...process.env,
		CURL_EXIT: "0",
		DUMP_EXIT: "0",
		IMPORT_EXIT: "0",
		RUNNER_TEMP: dir.replace(/\\/g, "/"),
		GITHUB_OUTPUT: join(dir, "output").replace(/\\/g, "/"),
		CURL_ARGS: join(dir, "curl.args").replace(/\\/g, "/"),
		DUMP_ARGS: join(dir, "dump.args").replace(/\\/g, "/"),
		IMPORT_ARGS: join(dir, "import.args").replace(/\\/g, "/"),
		IMPORTED_SQL: join(dir, "import.sql").replace(/\\/g, "/"),
		...failures,
	};
	const shell =
		process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
	const stub = String.raw`
python3() { case "$*" in *u.hostname*) printf 'db.fixture.example 3306 ci fixture\n';; *) printf 'fixture-password';; esac; }
curl() { printf '%s\0' "$@" > "$CURL_ARGS"; return "$CURL_EXIT"; }
mysqldump() { printf '%s\0' "$@" > "$DUMP_ARGS"; printf 'CREATE DATABASE fixture;\n'; return "$DUMP_EXIT"; }
mysql() { printf '%s\0' "$@" > "$IMPORT_ARGS"; cat > "$IMPORTED_SQL"; return "$IMPORT_EXIT"; }
`;
	const result = spawnSync(
		shell,
		["--noprofile", "--norc", "-e", "-c", stub + productionDumpScript()],
		{ env, encoding: "utf8", timeout: 5000 },
	);
	assert.ifError(result.error);
	return {
		result,
		env,
		args: (file) => readFileSync(file, "utf8").split("\0").filter(Boolean),
	};
}

test("production export overrides setup-mysql's local CA and verifies the RDS hostname", (t) => {
	const f = dumpFixture(t);
	assert.equal(f.result.status, 0, f.result.stderr);
	const bundle = `${f.env.RUNNER_TEMP}/rds-ca-bundle.pem`;
	assert.deepEqual(f.args(f.env.CURL_ARGS), [
		"--fail",
		"--silent",
		"--show-error",
		"--proto",
		"=https",
		"--tlsv1.2",
		"https://truststore.pki.rds.amazonaws.com/il-central-1/il-central-1-bundle.pem",
		"--output",
		bundle,
	]);
	const dump = f.args(f.env.DUMP_ARGS);
	assert.ok(dump.includes(`--ssl-ca=${bundle}`));
	assert.ok(dump.includes("--ssl-mode=VERIFY_IDENTITY"));
	assert.ok(dump.includes("--single-transaction"));
	assert.ok(dump.includes("--ignore-table=fixture.note"));
	assert.deepEqual(f.args(f.env.IMPORT_ARGS), [
		"-h",
		"127.0.0.1",
		"-u",
		"root",
		"-ptest_123",
	]);
	assert.match(
		readFileSync(f.env.IMPORTED_SQL, "utf8"),
		/CREATE DATABASE fixture;/,
	);
	assert.equal(
		readFileSync(f.env.GITHUB_OUTPUT, "utf8"),
		"local_db_url=mysql://root:test_123@127.0.0.1:3306/fixture\n",
	);
});

for (const [stage, failure] of [
	["CA download", { CURL_EXIT: "22" }],
	["production dump", { DUMP_EXIT: "2" }],
	["local import", { IMPORT_EXIT: "1" }],
]) {
	test(`failed ${stage} prevents manifest replay handoff`, (t) => {
		const f = dumpFixture(t, failure);
		assert.notEqual(f.result.status, 0);
		assert.throws(() => readFileSync(f.env.GITHUB_OUTPUT), { code: "ENOENT" });
		if (failure.CURL_EXIT)
			assert.throws(() => readFileSync(f.env.DUMP_ARGS), { code: "ENOENT" });
	});
}

async function recoveryFixture(t) {
	const f = await fixture(t);
	Object.assign(f.env, {
		GITHUB_REPOSITORY: "example/project",
		RDS_BUILD_TARGET_RUN_ID: "1234",
		RDS_BUILD_TARGET_RUN_ATTEMPT: "2",
	});
	const source = "a".repeat(40);
	const metadata = {
		id: 1234,
		run_attempt: 2,
		head_sha: source,
		name: "Continuous Integration",
		path: ".github/workflows/ci.yml",
		repository: { full_name: f.env.GITHUB_REPOSITORY },
		head_repository: { full_name: f.env.GITHUB_REPOSITORY },
		status: "completed",
		conclusion: "failure",
	};
	const job = {
		id: 7,
		run_id: 1234,
		run_attempt: 2,
		head_sha: source,
		name: "Package Website ARM64 / Package",
		status: "completed",
		conclusion: "failure",
		// GitHub can finish the lost-runner job while its last step stays active.
		steps: [{ name: "Export Docker Image", status: "in_progress" }],
	};
	const inventory = { total_count: 1, jobs: [job] };
	const database = {
		DBInstances: [
			{
				DBInstanceIdentifier: "tanah-mysql",
				DBInstanceArn: "arn:aws:rds:il-central-1:123456789012:db:tanah-mysql",
				VpcSecurityGroups: [
					{ VpcSecurityGroupId: f.env.RDS_SECURITY_GROUP, Status: "active" },
				],
			},
		],
	};
	const githubCalls = [];
	const github = async (endpoint) => {
		githubCalls.push(endpoint);
		assert.ok(
			endpoint.startsWith("repos/example/project/actions/runs/1234/attempts/2"),
		);
		return structuredClone(endpoint.includes("/jobs?") ? inventory : metadata);
	};
	f.setRules([f.rule()]);
	const aws = async (args) => {
		if (args[0] === "rds") {
			f.calls.push(args);
			return structuredClone(database);
		}
		return f.aws(args);
	};
	return {
		...f,
		metadata,
		job,
		inventory,
		database,
		githubCalls,
		deps: { aws, github },
	};
}

const revokes = (f) =>
	f.calls.filter((args) => args[1] === "revoke-security-group-ingress");

test("both native build leases are cleaned while a newer attempt stays untouched", async (t) => {
	const f = await recoveryFixture(t);
	const second = f.rule();
	second.SecurityGroupRuleId = "sgr-11111111111111111";
	second.CidrIpv4 = "198.51.100.8/32";
	second.Tags.find((tag) => tag.Key === "BuildLease").Value =
		"11111111-1111-4111-a111-111111111111";
	const newer = structuredClone(second);
	newer.SecurityGroupRuleId = "sgr-22222222222222222";
	newer.Tags.find((tag) => tag.Key === "RunAttempt").Value = "3";
	let rules = [f.rule(), second, newer];
	const aws = async (args) => {
		if (args[1] === "describe-security-group-rules") {
			const idFilter = args.find((arg) =>
				arg.startsWith("Name=security-group-rule-id,Values="),
			);
			return {
				SecurityGroupRules: structuredClone(
					rules.filter((rule) =>
						idFilter
							? rule.SecurityGroupRuleId === idFilter.split("Values=")[1]
							: rule.Tags.some(
									(tag) => tag.Key === "RunAttempt" && tag.Value === "2",
								),
					),
				),
			};
		}
		if (args[1] === "revoke-security-group-ingress") {
			f.calls.push(args);
			rules = rules.filter((rule) => rule.SecurityGroupRuleId !== args.at(-1));
			return { Return: true };
		}
		return f.deps.aws(args);
	};
	assert.deepEqual(
		(await cleanupCompletedBuild(f.env, { ...f.deps, aws })).removed,
		[ruleId, second.SecurityGroupRuleId],
	);
	assert.deepEqual(rules, [newer]);
	assert.equal(revokes(f).length, 2);
});

test("recovery rejects excessive rules and incomplete bounded job pages", async (t) => {
	const f = await recoveryFixture(t);
	f.setRules(
		[0, 1, 2].map((index) => {
			const rule = f.rule();
			rule.Tags.find((tag) => tag.Key === "BuildLease").Value =
				`${index}1111111-1111-4111-a111-111111111111`;
			return rule;
		}),
	);
	await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /Ambiguous/);
	assert.equal(revokes(f).length, 0);
	const github = async (endpoint) => {
		if (!endpoint.includes("/jobs?")) return f.metadata;
		return {
			total_count: 1000,
			jobs: [{ ...f.job, id: Number(endpoint.split("page=").at(-1)) }],
		};
	};
	await assert.rejects(
		completedBuildRun(f.env, { github }),
		/exceeds the cleanup bound/,
	);
});

test("a completed lost-runner attempt is recovered without its local journal and repeated cleanup is harmless", async (t) => {
	const f = await recoveryFixture(t);
	const result = await cleanupCompletedBuild(f.env, f.deps);
	assert.deepEqual(result, { run: "1234", attempt: "2", removed: [ruleId] });
	assert.deepEqual(revokes(f), [
		[
			"ec2",
			"revoke-security-group-ingress",
			"--group-id",
			f.env.RDS_SECURITY_GROUP,
			"--security-group-rule-ids",
			ruleId,
		],
	]);
	const reads = f.calls.filter(
		(args) => args[1] === "describe-security-group-rules",
	);
	assert.ok(reads[0].includes("Name=tag:Source,Values=github-actions-build"));
	assert.ok(reads[0].includes("Name=tag:RunId,Values=1234"));
	assert.ok(reads[0].includes("Name=tag:RunAttempt,Values=2"));
	assert.ok(reads[1].includes(`Name=security-group-rule-id,Values=${ruleId}`));
	assert.equal(reads.length, 3);
	assert.deepEqual(await cleanupCompletedBuild(f.env, f.deps), {
		run: "1234",
		attempt: "2",
		removed: [],
	});
	assert.equal(revokes(f).length, 1);
});

for (const change of [
	{ id: 5678 },
	{ run_attempt: 3 },
	{ name: "Other workflow" },
	{ path: ".github/workflows/untrusted.yml" },
	{ repository: { full_name: "foreign/project" } },
	{ head_repository: { full_name: "fork/project" } },
	{ status: "in_progress" },
	{ conclusion: null },
	{ head_sha: "not-a-commit" },
]) {
	test(`recovery refuses untrusted or active CI metadata ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		Object.assign(f.metadata, change);
		await assert.rejects(
			cleanupCompletedBuild(f.env, f.deps),
			/completed CI attempt/,
		);
		assert.equal(f.calls.length, 0);
	});
}

for (const change of [
	{ GITHUB_REPOSITORY: "../project" },
	{ GITHUB_REPOSITORY: "example/../project" },
	{ RDS_BUILD_TARGET_RUN_ID: "0" },
	{ RDS_BUILD_TARGET_RUN_ATTEMPT: "-1" },
]) {
	test(`invalid recovery input never reaches GitHub ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		await assert.rejects(
			completedBuildRun({ ...f.env, ...change }, f.deps),
			/Invalid completed/,
		);
		assert.equal(f.githubCalls.length, 0);
	});
}

test("all pages of the exact attempt are checked before AWS, including an active last-page job", async (t) => {
	const f = await recoveryFixture(t);
	const jobs = Array.from({ length: 101 }, (_, index) => ({
		...f.job,
		id: index + 1,
	}));
	const github = async (endpoint) => {
		if (!endpoint.includes("/jobs?")) return f.metadata;
		const page = Number(
			new URL(endpoint, "https://api.github.com/").searchParams.get("page"),
		);
		return {
			total_count: jobs.length,
			jobs: jobs.slice((page - 1) * 100, page * 100),
		};
	};
	assert.equal((await completedBuildRun(f.env, { github })).jobs.length, 101);
	jobs[100].status = "in_progress";
	await assert.rejects(
		cleanupCompletedBuild(f.env, { ...f.deps, github }),
		/active, incomplete/,
	);
	assert.equal(f.calls.length, 0);
});

for (const change of [
	{ id: "7" },
	{ run_id: 1235 },
	{ run_attempt: 3 },
	{ head_sha: "b".repeat(40) },
	{ status: "queued" },
	{ conclusion: null },
]) {
	test(`recovery refuses incomplete or mismatched job ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		Object.assign(f.job, change);
		await assert.rejects(
			cleanupCompletedBuild(f.env, f.deps),
			/active, incomplete/,
		);
		assert.equal(f.calls.length, 0);
	});
}

for (const change of [
	{ total_count: -1 },
	{ total_count: 1001 },
	{ total_count: "1" },
	{ total_count: 0 },
	{ total_count: 2, jobs: [] },
	{ jobs: null },
]) {
	test(`incomplete job inventories fail closed ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		Object.assign(f.inventory, change);
		await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /job inventory/);
		assert.equal(f.calls.length, 0);
	});
}

test("duplicate and changing paginated inventories cannot reach AWS", async (t) => {
	const f = await recoveryFixture(t);
	f.inventory.jobs.push(f.job);
	f.inventory.total_count = 2;
	await assert.rejects(
		cleanupCompletedBuild(f.env, f.deps),
		/active, incomplete/,
	);
	const github = async (endpoint) => {
		if (!endpoint.includes("/jobs?")) return f.metadata;
		return { total_count: endpoint.endsWith("page=1") ? 2 : 3, jobs: [f.job] };
	};
	await assert.rejects(
		cleanupCompletedBuild(f.env, { ...f.deps, github }),
		/Invalid CI job inventory/,
	);
	assert.equal(f.calls.length, 0);
});

test("a previous completed attempt is read by its immutable attempt endpoint", async (t) => {
	const f = await recoveryFixture(t);
	await completedBuildRun(f.env, f.deps);
	assert.deepEqual(f.githubCalls, [
		"repos/example/project/actions/runs/1234/attempts/2",
		"repos/example/project/actions/runs/1234/attempts/2/jobs?per_page=100&page=1",
	]);
});

test("wrong AWS account or region cannot inspect or revoke database access", async (t) => {
	const f = await recoveryFixture(t);
	await assert.rejects(
		cleanupCompletedBuild({ ...f.env, AWS_REGION: "us-east-1" }, f.deps),
		/region/,
	);
	assert.equal(f.calls.length, 0);
	await assert.rejects(
		cleanupCompletedBuild(f.env, {
			...f.deps,
			aws: async () => ({ Account: "111111111111" }),
		}),
		/account/,
	);
	assert.equal(revokes(f).length, 0);
});

for (const change of [
	{ DBInstanceIdentifier: "foreign-db" },
	{ DBInstanceArn: "arn:aws:rds:us-east-1:111111111111:db:tanah-mysql" },
	{ VpcSecurityGroups: [] },
	{ VpcSecurityGroups: [{ VpcSecurityGroupId: "invalid", Status: "active" }] },
	{
		VpcSecurityGroups: [
			{ VpcSecurityGroupId: "sg-0123456789abcdef0", Status: "applying" },
		],
	},
]) {
	test(`recovery requires actual active database groups ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		Object.assign(f.database.DBInstances[0], change);
		await assert.rejects(
			cleanupCompletedBuild(f.env, f.deps),
			/database security group/,
		);
		assert.equal(revokes(f).length, 0);
	});
}

test("ambiguous database identities and duplicate groups are rejected", async (t) => {
	const f = await recoveryFixture(t);
	f.database.DBInstances.push(f.database.DBInstances[0]);
	await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /inventory/);
	f.database.DBInstances.pop();
	f.database.DBInstances[0].VpcSecurityGroups.push(
		f.database.DBInstances[0].VpcSecurityGroups[0],
	);
	await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /Duplicate/);
	assert.equal(revokes(f).length, 0);
});

for (const change of [
	{ GroupOwnerId: "111111111111" },
	{ GroupId: "sg-11111111111111111" },
	{ IsEgress: true },
	{ IpProtocol: "-1" },
	{ FromPort: 0 },
	{ ToPort: 65535 },
	{ CidrIpv4: "198.51.100.7/24" },
	{ CidrIpv4: "::1/32" },
	{ SecurityGroupRuleId: "invalid" },
	{ Tags: [] },
]) {
	test(`recovery refuses unsafe rule fields ${JSON.stringify(change)}`, async (t) => {
		const f = await recoveryFixture(t);
		f.setRules([{ ...f.rule(), ...change }]);
		await assert.rejects(cleanupCompletedBuild(f.env, f.deps));
		assert.equal(revokes(f).length, 0);
	});
}

for (const [key, value] of Object.entries({
	Source: "foreign",
	RunId: "5678",
	RunAttempt: "3",
	Job: "foreign",
	BuildLease: "invalid",
})) {
	test(`recovery never revokes a foreign ${key} tag`, async (t) => {
		const f = await recoveryFixture(t);
		const rule = f.rule();
		rule.Tags.find((tag) => tag.Key === key).Value = value;
		f.setRules([rule]);
		await assert.rejects(cleanupCompletedBuild(f.env, f.deps));
		assert.equal(revokes(f).length, 0);
	});
}

test("the entire rule set is validated before deleting even one valid lease", async (t) => {
	const f = await recoveryFixture(t);
	f.setRules([f.rule(), { ...f.rule(), IpProtocol: "-1" }]);
	await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /does not match/);
	assert.equal(revokes(f).length, 0);
	f.setRules([f.rule(), f.rule()]);
	await assert.rejects(cleanupCompletedBuild(f.env, f.deps), /Ambiguous/);
	assert.equal(revokes(f).length, 0);
});

test("rules require a real completed website package job", async (t) => {
	const f = await recoveryFixture(t);
	f.job.name = "Package API / Package";
	await assert.rejects(
		cleanupCompletedBuild(f.env, f.deps),
		/completed website build/,
	);
	assert.equal(revokes(f).length, 0);
});

test("truncated rule inventory, fresh ownership changes, and ambiguous ID reads fail closed", async (t) => {
	const f = await recoveryFixture(t);
	for (const response of [
		{ NextToken: "more", SecurityGroupRules: [f.rule()] },
		{},
	]) {
		const aws = async (args) =>
			args[1] === "describe-security-group-rules" ? response : f.deps.aws(args);
		await assert.rejects(
			cleanupCompletedBuild(f.env, { ...f.deps, aws }),
			/incomplete/,
		);
	}
	for (const rules of [
		[{ ...f.rule(), CidrIpv4: "198.51.100.8/32" }],
		[f.rule(), f.rule()],
	]) {
		const aws = async (args) =>
			args.includes(`Name=security-group-rule-id,Values=${ruleId}`)
				? { SecurityGroupRules: rules }
				: f.deps.aws(args);
		await assert.rejects(cleanupCompletedBuild(f.env, { ...f.deps, aws }));
	}
	assert.equal(revokes(f).length, 0);
});

test("concurrent ordinary cleanup can remove a rule before the final read", async (t) => {
	const f = await recoveryFixture(t);
	const aws = async (args) =>
		args.includes(`Name=security-group-rule-id,Values=${ruleId}`)
			? { SecurityGroupRules: [] }
			: f.deps.aws(args);
	assert.deepEqual(
		(await cleanupCompletedBuild(f.env, { ...f.deps, aws })).removed,
		[],
	);
	assert.equal(revokes(f).length, 0);
});

test("recovery requires a revoke acknowledgment and independent absence proof", async (t) => {
	const f = await recoveryFixture(t);
	for (const Return of [false, true]) {
		const aws = async (args) =>
			args[1] === "revoke-security-group-ingress"
				? { Return }
				: f.deps.aws(args);
		await assert.rejects(
			cleanupCompletedBuild(f.env, { ...f.deps, aws }),
			Return ? /still present/ : /did not confirm/,
		);
	}
});

test("privileged completion cleanup checks trusted default-branch code before AWS authentication", () => {
	const workflow = readFileSync(
		new URL(
			"../../../.github/workflows/rds-build-access-cleanup.yml",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(workflow, /workflow_run:[\s\S]*types: \[completed\]/);
	assert.match(
		workflow,
		/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
	);
	assert.ok(
		workflow.indexOf("rds-build-access.mjs check-run") <
			workflow.indexOf("aws-actions/configure-aws-credentials"),
	);
	assert.doesNotMatch(workflow, /download-artifact|workflow_run\.head_sha/);
	assert.match(workflow, /actions: read/);
	assert.match(workflow, /cancel-in-progress: false/);
});
