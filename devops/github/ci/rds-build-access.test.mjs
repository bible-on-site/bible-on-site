import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	cleanupAccess,
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
		.map((line) => line.replace(/^          /, ""))
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
				script.replace("${{ steps.dump_prod.outputs.local_db_url }}", url),
		],
		{ encoding: "utf8", timeout: 5000, env: { ...process.env, LOCAL_DB_URL: url } },
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
