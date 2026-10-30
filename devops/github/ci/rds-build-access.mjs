import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNT = "250598594267";
const REGION = "il-central-1";
const SOURCE = "github-actions-build";

function awsCli(args) {
	return JSON.parse(
		execFileSync(
			"aws",
			[...args, "--region", REGION, "--output", "json", "--no-cli-pager"],
			{ encoding: "utf8" },
		),
	);
}

export function runnerIpv4(value) {
	const ip = value.trim();
	if (isIP(ip) !== 4)
		throw new Error("Runner public IP must be one IPv4 address");
	return ip;
}

async function lookupIp() {
	const response = await fetch("https://checkip.amazonaws.com", {
		signal: AbortSignal.timeout(2000),
	});
	if (!response.ok)
		throw new Error(`Public IP lookup failed (${response.status})`);
	return response.text();
}

function context(env) {
	if (env.AWS_REGION !== REGION) throw new Error("Unexpected AWS region");
	if (!env.RDS_BUILD_ACCESS_LEASE)
		throw new Error("Missing build access lease path");
	if (!/^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(env.RDS_SECURITY_GROUP ?? ""))
		throw new Error("Invalid RDS security group");
	if (
		!/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
		!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
		!/^[\w-]+$/.test(env.GITHUB_JOB ?? "")
	)
		throw new Error("Invalid build identity");
	return {
		account: ACCOUNT,
		region: REGION,
		group: env.RDS_SECURITY_GROUP,
		run: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT,
		job: env.GITHUB_JOB,
	};
}

async function checkAccount(aws) {
	const identity = await aws(["sts", "get-caller-identity"]);
	if (identity.Account !== ACCOUNT) throw new Error("Unexpected AWS account");
}

function tagsFor(lease) {
	return {
		Source: SOURCE,
		RunId: lease.run,
		RunAttempt: lease.attempt,
		Job: lease.job,
		BuildLease: lease.nonce,
	};
}

function validateLease(lease, expected) {
	for (const [key, value] of Object.entries(expected)) {
		if (lease[key] !== value)
			throw new Error(`Build access lease ${key} mismatch`);
	}
	if (
		!/^[a-f0-9-]{36}$/.test(lease.nonce ?? "") ||
		lease.cidr !== `${runnerIpv4(lease.ip)}/32`
	)
		throw new Error("Invalid build access lease");
	if (lease.ruleId && !/^sgr-[a-f0-9]{17}$/.test(lease.ruleId))
		throw new Error("Invalid security group rule ID");
}

function validateRule(rule, lease) {
	const tags = Object.fromEntries(
		(rule.Tags ?? []).map(({ Key, Value }) => [Key, Value]),
	);
	if (
		Object.entries(tagsFor(lease)).some(
			([key, value]) => tags[key] !== value,
		) ||
		rule.GroupOwnerId !== lease.account ||
		rule.GroupId !== lease.group ||
		rule.IsEgress !== false ||
		rule.IpProtocol !== "tcp" ||
		rule.FromPort !== 3306 ||
		rule.ToPort !== 3306 ||
		rule.CidrIpv4 !== lease.cidr ||
		!/^sgr-[a-f0-9]{17}$/.test(rule.SecurityGroupRuleId ?? "") ||
		(lease.ruleId && rule.SecurityGroupRuleId !== lease.ruleId)
	) {
		throw new Error(
			"Refusing to revoke a rule that does not match this build's lease",
		);
	}
}

// Journal the random ownership tag before requesting access. Cleanup can recover
// a successful grant even if the CLI response or the subsequent receipt write fails.
export async function grantAccess(
	env,
	{ aws = awsCli, publicIp = lookupIp, nonce = randomUUID } = {},
) {
	const expected = context(env);
	const ip = runnerIpv4(await publicIp());
	const lease = { ...expected, ip, cidr: `${ip}/32`, nonce: nonce() };
	validateLease(lease, expected);
	await checkAccount(aws);
	writeFileSync(env.RDS_BUILD_ACCESS_LEASE, `${JSON.stringify(lease)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	const response = await aws([
		"ec2",
		"authorize-security-group-ingress",
		"--group-id",
		lease.group,
		"--protocol",
		"tcp",
		"--port",
		"3306",
		"--cidr",
		lease.cidr,
		"--tag-specifications",
		JSON.stringify([
			{
				ResourceType: "security-group-rule",
				Tags: Object.entries(tagsFor(lease)).map(([Key, Value]) => ({
					Key,
					Value,
				})),
			},
		]),
	]);
	if (response.Return !== true || response.SecurityGroupRules?.length !== 1)
		throw new Error("Missing successful security group rule receipt");
	const rule = response.SecurityGroupRules[0];
	validateRule(rule, lease);
	lease.ruleId = rule.SecurityGroupRuleId;
	// Keep the write-ahead journal intact if writing the full receipt fails.
	const receiptPath = `${env.RDS_BUILD_ACCESS_LEASE}.receipt`;
	writeFileSync(receiptPath, `${JSON.stringify(lease)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(receiptPath, env.RDS_BUILD_ACCESS_LEASE);
	console.log(`Granted build access with owned rule ${lease.ruleId}`);
	return lease;
}

export async function cleanupAccess(env, { aws = awsCli } = {}) {
	let lease;
	try {
		lease = JSON.parse(readFileSync(env.RDS_BUILD_ACCESS_LEASE, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	validateLease(lease, context(env));
	await checkAccount(aws);
	const query = [
		"ec2",
		"describe-security-group-rules",
		"--filters",
		`Name=group-id,Values=${lease.group}`,
		`Name=tag:BuildLease,Values=${lease.nonce}`,
	];
	const response = await aws(query);
	if (!Array.isArray(response.SecurityGroupRules))
		throw new Error("Missing security group rule query result");
	const rules = response.SecurityGroupRules;
	if (rules.length === 0) return;
	if (rules.length !== 1) throw new Error("Ambiguous build access ownership");
	validateRule(rules[0], lease);
	const revoked = await aws([
		"ec2",
		"revoke-security-group-ingress",
		"--group-id",
		lease.group,
		"--security-group-rule-ids",
		rules[0].SecurityGroupRuleId,
	]);
	if (revoked.Return !== true)
		throw new Error("AWS did not confirm build access removal");
	const after = await aws(query);
	if (
		!Array.isArray(after.SecurityGroupRules) ||
		after.SecurityGroupRules.length !== 0
	)
		throw new Error("Build access rule still present after removal");
	console.log(
		`Removed owned build access rule ${rules[0].SecurityGroupRuleId}`,
	);
}

export function databaseHost(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Invalid database URL");
	}
	if (
		url.protocol !== "mysql:" ||
		(url.port && url.port !== "3306") ||
		!/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(url.hostname)
	)
		throw new Error("Invalid database host or port");
	return url.hostname;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		switch (process.argv[2]) {
			case "grant":
				await grantAccess(process.env);
				break;
			case "cleanup":
				await cleanupAccess(process.env);
				break;
			case "host":
				console.log(databaseHost(process.env.PROD_DB_URL));
				break;
			default:
				throw new Error("Usage: rds-build-access.mjs grant|cleanup|host");
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
