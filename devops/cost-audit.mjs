#!/usr/bin/env node
/**
 * Read-only AWS cost-safety audit for issue #2576.
 *
 * Reproduces the audited production baseline (account 250598594267,
 * il-central-1) as runnable checks so recurring audits stop depending on
 * ad-hoc CLI recall:
 *
 *   1. Identity guard - refuses to audit any account but the verified
 *      production account (the wrong-account incident is documented in
 *      docs/aws/cost-risk-audit-2026-10-23.md).
 *   2. Spend - Cost Explorer UnblendedCost by service, monthly completed
 *      months plus a daily current-month view. UsageQuantity is only read
 *      for the --service USAGE_TYPE drill-down (the S3 breakdown used in
 *      docs/aws/s3-delivery-cost-2026-11-01.md): CE sums quantity across a
 *      group, so service-level rows have no meaningful unit to report.
 *   3. Guardrails - the cost-relevant live settings that must not drift:
 *      log retention (180/365/365 days), per-service capacity (admin-only
 *      FARGATE_SPOT, website/API on-demand, desired 1), the sole nginx
 *      router (t3.small, running), both preserved VPC endpoints, and the
 *      asset CDN staying on Managed-CachingDisabled.
 *   4. Observability - informational gaps the November 1 cost report could
 *      not close: AWS Budgets, Cost Explorer anomaly monitors, S3 request
 *      metrics and bucket access logging. Reference IaC for the alerting
 *      half lives in docs/aws/cloudformation/cost-monitoring.yaml.
 *
 * Every call is a read-only `aws` CLI invocation. Cost Explorer charges a
 * small per-request fee for its API; pass --skip-spend to audit guardrails
 * only, which skips every `ce` call including the anomaly-monitor check.
 *
 * Usage:
 *   node devops/cost-audit.mjs [--profile NAME] [--months N] [--service NAME]
 *                              [--skip-spend] [--json]
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const ACCOUNT_ID = "250598594267"; // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
export const REGION = "il-central-1";
// Cost Explorer, AWS Budgets and AWS/Billing metrics are global surfaces
// served from us-east-1 regardless of where the resources live.
export const GLOBAL_REGION = "us-east-1";
const DEFAULT_PROFILE = `AdministratorAccess-${ACCOUNT_ID}`;

const ASSETS_BUCKET = "bible-on-site-assets";
const ASSETS_DISTRIBUTION_ID = "E1WMX9UV9D2726";
// Managed-CachingDisabled; edge caching in front of the assets origin is a
// gated #2576 migration, not an accepted state.
const CACHING_DISABLED_POLICY_ID = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ROUTER_INSTANCE_ID = "i-0d811651c11294634";
const ROUTER_INSTANCE_TYPE = "t3.small";
const VPC_ENDPOINT_IDS = ["vpce-0dd7903d30e03208c", "vpce-0388b3ea36b6a3214"];
const ECS_CLUSTER = "bible-on-site-cluster";
const LOG_RETENTION_DAYS = {
	"/ecs/bible-on-site-website": 180,
	"/ecs/bible-on-site-api": 365,
	"/ecs/bible-on-site-admin": 365,
};
const EXPECTED_SERVICES = [
	{ name: "bible-on-site-website", provider: "FARGATE" },
	{ name: "bible-on-site-api", provider: "FARGATE" },
	{ name: "bible-on-site-admin", provider: "FARGATE_SPOT" },
];

const USAGE =
	"Usage: node devops/cost-audit.mjs [--profile NAME] [--months N] [--service NAME] [--skip-spend] [--json]";

export function parseArgs(args) {
	const options = {
		profile: DEFAULT_PROFILE,
		months: 3,
		service: null,
		skipSpend: false,
		asJson: false,
		help: false,
	};
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--profile":
				options.profile = args[++i];
				if (!options.profile) throw new Error("--profile requires a name");
				break;
			case "--months":
				options.months = Number(args[++i]);
				if (!Number.isSafeInteger(options.months) || options.months < 1 || options.months > 36) {
					throw new Error("--months must be an integer between 1 and 36");
				}
				break;
			case "--service":
				options.service = args[++i];
				if (!options.service) throw new Error("--service requires a service name");
				break;
			case "--skip-spend":
				options.skipSpend = true;
				break;
			case "--json":
				options.asJson = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${args[i]}`);
		}
	}
	return options;
}

/** Inclusive-first-day / exclusive-first-day month boundary helpers (CE End is exclusive). */
export function firstOfMonth(date, offsetMonths = 0) {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

function isoDate(date) {
	return date.toISOString().slice(0, 10);
}

/**
 * The spend queries the audit runs. Monthly covers the last `months`
 * completed months grouped by service; daily covers the current month to
 * date. --service retargets the daily query to that service's usage types,
 * matching the S3 breakdown in docs/aws/s3-delivery-cost-2026-11-01.md.
 * UsageQuantity is only requested for the usage-type view: service groups
 * span incompatible units and CE adds them into a meaningless total.
 */
export function spendQueries({ months = 3, service = null, today = new Date() } = {}) {
	const ce = ({ timePeriod, granularity, groupKey, filter, withUsage = false }) => {
		const args = [
			"ce",
			"get-cost-and-usage",
			"--time-period",
			`Start=${isoDate(timePeriod.start)},End=${isoDate(timePeriod.end)}`,
			"--granularity",
			granularity,
			"--metrics",
			"UnblendedCost",
		];
		if (withUsage) args.push("UsageQuantity");
		args.push("--group-by", `Type=DIMENSION,Key=${groupKey}`);
		if (filter) args.push("--filter", filter);
		return args;
	};
	const currentMonth = firstOfMonth(today);
	const monthly = {
		label: "monthly",
		args: ce({
			timePeriod: { start: firstOfMonth(currentMonth, -months), end: currentMonth },
			granularity: "MONTHLY",
			groupKey: "SERVICE",
		}),
	};
	const daily = {
		label: service ? `daily ${service} usage types` : "daily",
		args: ce({
			timePeriod: { start: currentMonth, end: firstOfMonth(currentMonth, 1) },
			granularity: "DAILY",
			groupKey: service ? "USAGE_TYPE" : "SERVICE",
			filter: service ? JSON.stringify({ Dimensions: { Key: "SERVICE", Values: [service] } }) : null,
			withUsage: Boolean(service),
		}),
	};
	return [monthly, daily];
}

/**
 * Normalizes a GetCostAndUsage response into flat rows.
 * UsageQuantity amounts are kept with their unit; quantities in different
 * units are never added together (the billing-report warning in the S3 cost
 * doc). Sorting is deterministic: period start, then cost descending.
 */
export function parseCostAndUsage(response) {
	const rows = [];
	for (const byTime of response?.ResultsByTime ?? []) {
		const start = byTime.TimePeriod?.Start;
		for (const group of byTime.Groups ?? []) {
			const cost = Number(group.Metrics?.UnblendedCost?.Amount ?? "0");
			const quantity = group.Metrics?.UsageQuantity;
			rows.push({
				start,
				group: (group.Keys ?? []).join(" / "),
				costUsd: cost,
				costUnit: group.Metrics?.UnblendedCost?.Unit ?? "USD",
				usageAmount: quantity ? Number(quantity.Amount) : null,
				usageUnit: quantity?.Unit ?? null,
			});
		}
	}
	rows.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : b.costUsd - a.costUsd));
	return rows;
}

/** Per-unit totals. USD costs and each usage unit get independent sums. */
export function summarizeUsage(rows) {
	const totals = new Map();
	for (const row of rows) {
		if (row.usageAmount === null || !row.usageUnit) continue;
		const key = `${row.group}|${row.usageUnit}`;
		totals.set(key, (totals.get(key) ?? 0) + row.usageAmount);
	}
	return totals;
}

/**
 * Providers that actually place tasks for one ECS service description.
 * A capacity-provider entry only places tasks when its weight or base is
 * nonzero (base tasks are placed before weighted tasks); a zero-weight,
 * zero-base entry is inert. When no strategy exists, launchType applies.
 */
function providersOf(service) {
	const strategy = service.capacityProviderStrategy ?? [];
	if (strategy.length === 0) return [service.launchType].filter(Boolean);
	return strategy.filter((entry) => (entry.weight ?? 0) > 0 || (entry.base ?? 0) > 0).map((entry) => entry.capacityProvider);
}

/**
 * Guardrails: cost-relevant live state verified by the 2026-10-23 audit and
 * the November checks. A mismatch is a spend or availability regression and
 * fails the audit. `region`/`args` build the read-only CLI call; `evaluate`
 * maps the parsed JSON to {ok, expected, observed}.
 */
export const GUARD_CHECKS = [
	{
		id: "log-retention",
		title: "ECS log retention bounds stored bytes",
		region: REGION,
		args: ["logs", "describe-log-groups", "--log-group-name-prefix", "/ecs/bible-on-site"],
		evaluate(json) {
			const groups = Object.fromEntries((json.logGroups ?? []).map((g) => [g.logGroupName, g.retentionInDays]));
			const observed = Object.keys(LOG_RETENTION_DAYS).map((name) => {
				const found = name in groups ? (groups[name] === undefined ? "never" : `${groups[name]}d`) : "missing";
				return `${name.split("/").pop()}=${found}`;
			});
			const ok = Object.entries(LOG_RETENTION_DAYS).every(([name, days]) => groups[name] === days);
			return { ok, expected: "website=180d api=365d admin=365d", observed: observed.join(" ") };
		},
	},
	{
		id: "ecs-capacity",
		title: "Service sizes: admin-only Spot, desired 1 each, public services running",
		region: REGION,
		args: ["ecs", "describe-services", "--cluster", ECS_CLUSTER, "--services", ...EXPECTED_SERVICES.map((s) => s.name)],
		evaluate(json) {
			const byName = new Map((json.services ?? []).map((s) => [s.serviceName, s]));
			const parts = [];
			let ok = true;
			for (const { name, provider } of EXPECTED_SERVICES) {
				const service = byName.get(name);
				const short = name.replace("bible-on-site-", "");
				if (!service) {
					parts.push(`${short}=missing`);
					ok = false;
					continue;
				}
				const providers = providersOf(service);
				const desired = service.desiredCount;
				const running = service.runningCount ?? 0;
				const pending = service.pendingCount ?? 0;
				// The baseline is exclusive placement: admin tasks all on Spot,
				// public tasks all on-demand. Public services must also have a
				// running task; admin Spot interruptions are tolerated but still
				// reported so a stuck replacement is visible.
				const exclusive = providers.length > 0 && providers.every((p) => p === provider);
				const publicServing = provider !== "FARGATE_SPOT" ? running === 1 : true;
				const good = desired === 1 && exclusive && publicServing;
				ok &&= good;
				parts.push(`${short}=${providers.join("+") || "?"} desired=${desired} running=${running} pending=${pending}`);
			}
			return { ok, expected: "website/api FARGATE running=1, admin FARGATE_SPOT, desired=1", observed: parts.join(" ") };
		},
	},
	{
		id: "router",
		title: "Sole nginx router stays running on audited size",
		region: REGION,
		args: ["ec2", "describe-instances", "--instance-ids", ROUTER_INSTANCE_ID],
		evaluate(json) {
			const instance = json.Reservations?.[0]?.Instances?.[0];
			const state = instance?.State?.Name ?? "missing";
			const type = instance?.InstanceType ?? "?";
			return {
				ok: state === "running" && type === ROUTER_INSTANCE_TYPE,
				expected: `${ROUTER_INSTANCE_ID} running ${ROUTER_INSTANCE_TYPE}`,
				observed: `${state} ${type}`,
			};
		},
	},
	{
		id: "vpc-endpoints",
		title: "Preserved SSM/S3 VPC endpoints stay available",
		region: REGION,
		args: ["ec2", "describe-vpc-endpoints", "--vpc-endpoint-ids", ...VPC_ENDPOINT_IDS],
		evaluate(json) {
			const byId = new Map((json.VpcEndpoints ?? []).map((e) => [e.VpcEndpointId, e.State]));
			const observed = VPC_ENDPOINT_IDS.map((id) => `${id}=${byId.get(id) ?? "missing"}`);
			return {
				ok: VPC_ENDPOINT_IDS.every((id) => byId.get(id) === "available"),
				expected: "both endpoints available",
				observed: observed.join(" "),
			};
		},
	},
	{
		id: "cdn-caching",
		title: "Asset CDN keeps caching disabled",
		region: GLOBAL_REGION,
		args: ["cloudfront", "get-distribution", "--id", ASSETS_DISTRIBUTION_ID],
		evaluate(json) {
			const policy = json.Distribution?.DistributionConfig?.DefaultCacheBehavior?.CachePolicyId ?? "?";
			const enabled = json.Distribution?.DistributionConfig?.Enabled;
			return {
				ok: policy === CACHING_DISABLED_POLICY_ID && enabled === true,
				expected: `enabled with ${CACHING_DISABLED_POLICY_ID} (CachingDisabled)`,
				observed: `enabled=${enabled} policy=${policy}`,
			};
		},
	},
];

/**
 * Observability gaps flagged by the November 1 spend report. These never
 * fail the audit; they report whether the attribution tooling exists.
 */
export const OBSERVABILITY_CHECKS = [
	{
		id: "budgets",
		title: "AWS Budgets spend alerts",
		region: GLOBAL_REGION,
		args: ["budgets", "describe-budgets", "--account-id", ACCOUNT_ID],
		evaluate(json) {
			const count = (json.Budgets ?? []).length;
			return { observed: count === 0 ? "none configured" : `${count} budget(s)`, recommendation: "see docs/aws/cloudformation/cost-monitoring.yaml" };
		},
	},
	{
		id: "anomaly-monitors",
		title: "Cost Explorer anomaly detection",
		region: GLOBAL_REGION,
		args: ["ce", "get-anomaly-monitors"],
		evaluate(json) {
			const count = (json.AnomalyMonitors ?? []).length;
			return { observed: count === 0 ? "none configured" : `${count} monitor(s)`, recommendation: "see docs/aws/cloudformation/cost-monitoring.yaml" };
		},
	},
	{
		id: "assets-request-metrics",
		title: "S3 request metrics (per-request attribution)",
		region: REGION,
		args: ["s3api", "list-bucket-metrics-configurations", "--bucket", ASSETS_BUCKET],
		evaluate(json) {
			const count = (json.MetricsConfigurationList ?? []).length;
			return { observed: count === 0 ? "disabled" : `${count} configuration(s)`, recommendation: "aws s3api put-bucket-metrics-configuration --id EntireBucket" };
		},
	},
	{
		id: "assets-bucket-logging",
		title: "S3 server access logging (caller attribution)",
		region: REGION,
		args: ["s3api", "get-bucket-logging", "--bucket", ASSETS_BUCKET],
		evaluate(json) {
			const enabled = Boolean(json.LoggingEnabled?.TargetBucket);
			return { observed: enabled ? `enabled -> ${json.LoggingEnabled.TargetBucket}` : "disabled", recommendation: "gated; needs a log bucket + prefix design" };
		},
	},
];

async function awsJson(execute, args, profile, region) {
	const { stdout } = await execute("aws", [...args, "--output", "json", "--profile", profile, "--region", region]);
	return JSON.parse(stdout);
}

/**
 * GetCostAndUsage is not auto-paginated by the CLI: a response carrying
 * NextPageToken has more Groups for the same periods. Follow the token and
 * merge groups per period so no charges are silently dropped.
 */
async function awsJsonPaginated(execute, args, profile, region) {
	const merged = await awsJson(execute, args, profile, region);
	const byPeriod = new Map((merged.ResultsByTime ?? []).map((entry) => [entry.TimePeriod?.Start, entry]));
	let token = merged.NextPageToken;
	while (token) {
		const page = await awsJson(execute, [...args, "--next-page-token", token], profile, region);
		for (const entry of page.ResultsByTime ?? []) {
			const start = entry.TimePeriod?.Start;
			const existing = byPeriod.get(start);
			if (existing) existing.Groups = [...(existing.Groups ?? []), ...(entry.Groups ?? [])];
			else byPeriod.set(start, entry);
		}
		token = page.NextPageToken;
	}
	merged.ResultsByTime = [...byPeriod.values()];
	return merged;
}

async function runCheck(execute, check, profile) {
	try {
		const json = await awsJson(execute, check.args, profile, check.region);
		const result = check.evaluate(json);
		return { id: check.id, title: check.title, ...result };
	} catch (error) {
		const status = GUARD_CHECKS.includes(check) ? "error" : "skipped";
		return { id: check.id, title: check.title, status, observed: error.name ?? "error", detail: error.message };
	}
}

export async function audit({ profile = DEFAULT_PROFILE, months = 3, service = null, skipSpend = false } = {}, { execute = execFileAsync } = {}) {
	const identity = await awsJson(execute, ["sts", "get-caller-identity"], profile, REGION);
	if (identity.Account !== ACCOUNT_ID) {
		throw new Error(`Refusing to audit account ${identity.Account ?? "?"}; expected verified production account ${ACCOUNT_ID}`);
	}
	const checks = [];
	for (const check of GUARD_CHECKS) checks.push(await runCheck(execute, check, profile));
	for (const check of OBSERVABILITY_CHECKS) {
		// --skip-spend promises zero Cost Explorer calls; anomaly monitors are
		// a CE surface too, so the check is skipped rather than failed.
		if (skipSpend && check.args[0] === "ce") continue;
		checks.push(await runCheck(execute, check, profile));
	}

	const spend = {};
	if (!skipSpend) {
		for (const query of spendQueries({ months, service })) {
			const json = await awsJsonPaginated(execute, query.args, profile, GLOBAL_REGION);
			spend[query.label] = { rows: parseCostAndUsage(json) };
		}
	}

	return {
		generatedAt: new Date().toISOString(),
		account: identity.Account,
		region: REGION,
		profile,
		ok: checks.every((check) => check.ok !== false && check.status !== "error"),
		checks,
		spend,
	};
}

function money(value) {
	return `$${value.toFixed(4).replace(/\.?0+$/, "") || "0"}`;
}

export function formatReport(report) {
	const status = (check) => (check.status ? check.status : check.ok ? "ok" : "DRIFT");
	const lines = [
		`# AWS cost-safety audit (${report.generatedAt})`,
		`Account ${report.account} / ${report.region}, profile ${report.profile}. Read-only; exit code ${report.ok ? "0" : "1"}.`,
		"\n## Guardrails (a DRIFT or error fails the audit)",
		"| check | status | expected | observed |",
		"| --- | --- | --- | --- |",
	];
	for (const check of report.checks.filter((c) => GUARD_CHECKS.some((g) => g.id === c.id))) {
		lines.push(`| ${check.title} | ${status(check)} | ${check.expected ?? "-"} | ${check.observed ?? "-"} |`);
	}
	lines.push("\n## Observability (informational; gaps are recommendations, not failures)", "| check | observed | recommendation |", "| --- | --- | --- |");
	for (const check of report.checks.filter((c) => OBSERVABILITY_CHECKS.some((o) => o.id === c.id))) {
		lines.push(`| ${check.title} | ${check.observed ?? "-"} | ${check.recommendation ?? check.detail ?? "-"} |`);
	}
	for (const [label, section] of Object.entries(report.spend)) {
		lines.push(`\n## Spend - ${label} UnblendedCost`);
		lines.push("| period | group | cost | usage |", "| --- | --- | ---: | --- |");
		for (const row of section.rows) {
			const usage = row.usageUnit ? `${row.usageAmount} ${row.usageUnit}` : "-";
			lines.push(`| ${row.start} | ${row.group} | ${money(row.costUsd)} | ${usage} |`);
		}
	}
	return lines.join("\n");
}

export async function main(args = process.argv.slice(2), { execute = execFileAsync, write = console.log } = {}) {
	const options = parseArgs(args);
	if (options.help) {
		write(USAGE);
		return true;
	}
	const report = await audit(options, { execute });
	write(options.asJson ? JSON.stringify(report, null, 2) : formatReport(report));
	return report.ok;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main()
		.then((ok) => {
			process.exitCode = ok ? 0 : 1;
		})
		.catch((error) => {
			console.error(`Cost audit failed: ${error.message}`);
			process.exitCode = 1;
		});
}
