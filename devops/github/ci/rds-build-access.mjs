import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function githubCli(endpoint) {
	return JSON.parse(
		execFileSync("gh", ["api", "--method", "GET", endpoint], {
			encoding: "utf8",
			timeout: 20_000,
			maxBuffer: 4 * 1024 * 1024,
		}),
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
		account: deploymentAccount(env.RDS_BUILD_ACCESS_ROLE),
		region: REGION,
		group: env.RDS_SECURITY_GROUP,
		run: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT,
		job: env.GITHUB_JOB,
	};
}

export function deploymentAccount(role) {
	const parts = (role ?? "").split(":");
	if (
		parts.length !== 6 ||
		parts[0] !== "arn" ||
		parts[1] !== "aws" ||
		parts[2] !== "iam" ||
		parts[3] !== "" ||
		!/^[0-9]{12}$/.test(parts[4]) ||
		!parts[5].startsWith("role/") ||
		parts[5].length <= 5
	)
		throw new Error("Invalid configured AWS deployment role");
	return parts[4];
}

async function checkAccount(aws, expected) {
	const identity = await aws(["sts", "get-caller-identity"]);
	if (identity.Account !== expected) throw new Error("Unexpected AWS account");
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
	const fields = new Map(Object.entries(lease));
	for (const [key, value] of Object.entries(expected)) {
		if (fields.get(key) !== value)
			throw new Error(`Build access lease ${key} mismatch`);
	}
	if (!validNonce(lease.nonce) || lease.cidr !== `${runnerIpv4(lease.ip)}/32`)
		throw new Error("Invalid build access lease");
	if (lease.ruleId && !validRuleId(lease.ruleId))
		throw new Error("Invalid security group rule ID");
}

function hex(value) {
	return [...value].every((char) => "0123456789abcdef".includes(char));
}

function validNonce(value) {
	if (typeof value !== "string" || value.length !== 36) return false;
	const parts = value.split("-");
	return (
		parts.length === 5 &&
		parts.every(
			(part, index) => part.length === [8, 4, 4, 4, 12][index] && hex(part),
		)
	);
}

function validRuleId(value) {
	return (
		typeof value === "string" &&
		value.length === 21 &&
		value.startsWith("sgr-") &&
		hex(value.slice(4))
	);
}

function validateRule(rule, lease) {
	const tags = new Map((rule.Tags ?? []).map(({ Key, Value }) => [Key, Value]));
	if (
		Object.entries(tagsFor(lease)).some(
			([key, value]) => tags.get(key) !== value,
		) ||
		rule.GroupOwnerId !== lease.account ||
		rule.GroupId !== lease.group ||
		rule.IsEgress !== false ||
		rule.IpProtocol !== "tcp" ||
		rule.FromPort !== 3306 ||
		rule.ToPort !== 3306 ||
		rule.CidrIpv4 !== lease.cidr ||
		!validRuleId(rule.SecurityGroupRuleId) ||
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
	await checkAccount(aws, expected.account);
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
	const [rule] = response.SecurityGroupRules;
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
	await checkAccount(aws, lease.account);
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

/** Read the exact completed attempt, including every job before allowing cleanup. */
export async function completedBuildRun(env, { github = githubCli } = {}) {
	const repository = env.GITHUB_REPOSITORY;
	const run = env.RDS_BUILD_TARGET_RUN_ID;
	const attempt = env.RDS_BUILD_TARGET_RUN_ATTEMPT;
	if (
		!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
		repository.split("/").some((part) => part === "." || part === "..") ||
		!/^[1-9]\d*$/.test(run ?? "") ||
		!/^[1-9]\d*$/.test(attempt ?? "")
	)
		throw new Error("Invalid completed build identity");
	const prefix = `repos/${repository}/actions/runs/${run}/attempts/${attempt}`;
	const metadata = await github(prefix);
	if (
		String(metadata.id) !== run ||
		String(metadata.run_attempt) !== attempt ||
		metadata.name !== "Continuous Integration" ||
		metadata.path?.split("@")[0] !== ".github/workflows/ci.yml" ||
		metadata.repository?.full_name !== repository ||
		metadata.head_repository?.full_name !== repository ||
		metadata.status !== "completed" ||
		!metadata.conclusion ||
		!/^[a-f0-9]{40}$/.test(metadata.head_sha ?? "")
	)
		throw new Error("Cleanup requires the repository's completed CI attempt");
	const jobs = [];
	const ids = new Set();
	let total;
	for (let page = 1; page <= 10; page++) {
		const result = await github(`${prefix}/jobs?per_page=100&page=${page}`);
		total ??= result.total_count;
		if (
			!Number.isSafeInteger(total) ||
			total < 0 ||
			total > 1_000 ||
			result.total_count !== total ||
			!Array.isArray(result.jobs) ||
			result.jobs.length > 100
		)
			throw new Error("Invalid CI job inventory");
		for (const job of result.jobs) {
			if (
				!Number.isSafeInteger(job.id) ||
				ids.has(job.id) ||
				String(job.run_id) !== run ||
				String(job.run_attempt) !== attempt ||
				job.head_sha !== metadata.head_sha ||
				job.status !== "completed" ||
				!job.conclusion
			)
				throw new Error(
					"CI jobs are active, incomplete or belong to another attempt",
				);
			ids.add(job.id);
			jobs.push(job);
		}
		if (jobs.length === total)
			return { repository, run, attempt, source: metadata.head_sha, jobs };
		if (jobs.length > total || result.jobs.length === 0)
			throw new Error("Incomplete CI job inventory");
	}
	throw new Error("CI job inventory exceeds the cleanup bound");
}

function recoveryRules(response) {
	if (!Array.isArray(response?.SecurityGroupRules) || response.NextToken)
		throw new Error("Missing or incomplete build access rule inventory");
	return response.SecurityGroupRules;
}

async function databaseGroups(aws, account) {
	const database = await aws([
		"rds",
		"describe-db-instances",
		"--db-instance-identifier",
		"tanah-mysql",
	]);
	const instance = database.DBInstances?.[0];
	if (
		database.Marker ||
		database.DBInstances?.length !== 1 ||
		instance.DBInstanceIdentifier !== "tanah-mysql" ||
		instance.DBInstanceArn !==
			`arn:aws:rds:${REGION}:${account}:db:tanah-mysql` ||
		!Array.isArray(instance.VpcSecurityGroups) ||
		!instance.VpcSecurityGroups.length
	)
		throw new Error("Unexpected database security group inventory");
	const groups = instance.VpcSecurityGroups.map((group) => {
		if (
			group.Status !== "active" ||
			!/^sg-(?:[a-f0-9]{8}|[a-f0-9]{17})$/.test(group.VpcSecurityGroupId)
		)
			throw new Error("Unexpected database security group");
		return group.VpcSecurityGroupId;
	});
	if (new Set(groups).size !== groups.length)
		throw new Error("Duplicate database security group");
	return groups;
}

function recoveryLease(rule, group, account, build) {
	const tags = new Map((rule.Tags ?? []).map(({ Key, Value }) => [Key, Value]));
	const expected = {
		account,
		region: REGION,
		group,
		run: build.run,
		attempt: build.attempt,
	};
	const lease = {
		...expected,
		job: tags.get("Job"),
		nonce: tags.get("BuildLease"),
		ip: rule.CidrIpv4?.split("/")[0],
		cidr: rule.CidrIpv4,
		ruleId: rule.SecurityGroupRuleId,
	};
	if (
		lease.job !== "package" ||
		!build.jobs.some((job) =>
			/^Package Website(?: ARM64)? \/ Package$/.test(job.name),
		)
	)
		throw new Error("Rule does not belong to a completed website build");
	validateLease(lease, expected);
	validateRule(rule, lease);
	return lease;
}

async function completedBuildLeases(aws, groups, account, build) {
	const leases = [];
	for (const group of groups) {
		const rules = recoveryRules(
			await aws([
				"ec2",
				"describe-security-group-rules",
				"--filters",
				`Name=group-id,Values=${group}`,
				`Name=tag:Source,Values=${SOURCE}`,
				`Name=tag:RunId,Values=${build.run}`,
				`Name=tag:RunAttempt,Values=${build.attempt}`,
			]),
		);
		for (const rule of rules) {
			leases.push(recoveryLease(rule, group, account, build));
		}
	}
	if (
		leases.length > 2 ||
		new Set(leases.map((lease) => lease.nonce)).size !== leases.length
	)
		throw new Error("Ambiguous website build access ownership");
	return leases;
}

/** Recover access even when a lost runner could not execute its post steps. */
export async function cleanupCompletedBuild(
	env,
	{ aws = awsCli, github = githubCli } = {},
) {
	const build = await completedBuildRun(env, { github });
	if (env.AWS_REGION !== REGION) throw new Error("Unexpected AWS region");
	const account = deploymentAccount(env.RDS_BUILD_ACCESS_ROLE);
	await checkAccount(aws, account);
	const groups = await databaseGroups(aws, account);
	// Validate the entire inventory before revoking any rule.
	const leases = await completedBuildLeases(aws, groups, account, build);
	const removed = [];
	for (const lease of leases) {
		const query = [
			"ec2",
			"describe-security-group-rules",
			"--filters",
			`Name=group-id,Values=${lease.group}`,
			`Name=security-group-rule-id,Values=${lease.ruleId}`,
		];
		const fresh = recoveryRules(await aws(query));
		if (!fresh.length) continue;
		if (fresh.length !== 1) throw new Error("Ambiguous build access rule");
		validateRule(fresh[0], lease);
		const result = await aws([
			"ec2",
			"revoke-security-group-ingress",
			"--group-id",
			lease.group,
			"--security-group-rule-ids",
			lease.ruleId,
		]);
		if (result.Return !== true)
			throw new Error("AWS did not confirm build access removal");
		if (recoveryRules(await aws(query)).length)
			throw new Error("Build access rule still present after removal");
		removed.push(lease.ruleId);
	}
	return { run: build.run, attempt: build.attempt, removed };
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
			case "check-run": {
				const build = await completedBuildRun(process.env);
				console.log(
					`CI run ${build.run}, attempt ${build.attempt}: ${build.jobs.length} completed jobs`,
				);
				break;
			}
			case "cleanup-run": {
				const result = await cleanupCompletedBuild(process.env);
				console.log(
					`CI run ${result.run}, attempt ${result.attempt}: removed ${result.removed.length} owned rules${result.removed.length ? ` (${result.removed.join(", ")})` : ""}`,
				);
				break;
			}
			default:
				throw new Error(
					"Usage: rds-build-access.mjs grant|cleanup|host|check-run|cleanup-run",
				);
		}
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
