import assert from "node:assert/strict";
import test from "node:test";
import {
	ACCOUNT_ID,
	GLOBAL_REGION,
	GUARD_CHECKS,
	OBSERVABILITY_CHECKS,
	REGION,
	audit,
	firstOfMonth,
	formatReport,
	main,
	parseArgs,
	parseCostAndUsage,
	spendQueries,
	summarizeUsage,
} from "./cost-audit.mjs";

const USAGE = "Usage: node devops/cost-audit.mjs";

test("parseArgs keeps audited defaults and validates every option", () => {
	assert.deepEqual(parseArgs([]), {
		profile: `AdministratorAccess-${ACCOUNT_ID}`,
		months: 3,
		service: null,
		skipSpend: false,
		asJson: false,
		help: false,
	});
	assert.deepEqual(parseArgs(["--profile", "ops", "--months", "6", "--service", "Amazon Simple Storage Service", "--skip-spend", "--json"]), {
		profile: "ops",
		months: 6,
		service: "Amazon Simple Storage Service",
		skipSpend: true,
		asJson: true,
		help: false,
	});
	for (const months of [undefined, "0", "-2", "37", "1.5", "NaN"]) {
		assert.throws(() => parseArgs(["--months", months]), /--months must be an integer between 1 and 36/);
	}
	assert.throws(() => parseArgs(["--profile", ""]), /--profile requires a name/);
	assert.throws(() => parseArgs(["--service", ""]), /--service requires a service name/);
	assert.throws(() => parseArgs(["--delete-bucket"]), /Unknown argument: --delete-bucket/);
});

test("month boundaries stay on the exclusive-end convention", () => {
	const today = new Date("2026-11-09T12:00:00Z");
	assert.equal(firstOfMonth(today).toISOString().slice(0, 10), "2026-11-01");
	assert.equal(firstOfMonth(today, -3).toISOString().slice(0, 10), "2026-08-01");
	assert.equal(firstOfMonth(today, 1).toISOString().slice(0, 10), "2026-12-01");

	const [monthly, daily] = spendQueries({ months: 3, today });
	assert.ok(monthly.args.includes("Start=2026-08-01,End=2026-11-01"));
	assert.ok(monthly.args.includes("MONTHLY"));
	assert.ok(monthly.args.includes("Type=DIMENSION,Key=SERVICE"));
	assert.ok(daily.args.includes("Start=2026-11-01,End=2026-12-01"));
	assert.ok(daily.args.includes("DAILY"));
	assert.ok(!daily.args.includes("--filter"));
	// Service-grouped rows mix incompatible units, so quantity is only
	// requested for the single-service usage-type view.
	assert.ok(!monthly.args.includes("UsageQuantity"));
	assert.ok(!daily.args.includes("UsageQuantity"));

	const [, s3Daily] = spendQueries({ months: 1, service: "Amazon Simple Storage Service", today });
	assert.ok(s3Daily.args.includes("Type=DIMENSION,Key=USAGE_TYPE"));
	assert.ok(s3Daily.args.includes("UsageQuantity"));
	const filter = s3Daily.args[s3Daily.args.indexOf("--filter") + 1];
	assert.deepEqual(JSON.parse(filter), { Dimensions: { Key: "SERVICE", Values: ["Amazon Simple Storage Service"] } });
});

test("parseCostAndUsage flattens groups and never merges different units", () => {
	const response = {
		ResultsByTime: [
			{
				TimePeriod: { Start: "2026-10-01", End: "2026-11-01" },
				Groups: [
					{ Keys: ["Amazon Simple Storage Service"], Metrics: { UnblendedCost: { Amount: "65.72", Unit: "USD" }, UsageQuantity: { Amount: "660.506", Unit: "GB" } } },
					{ Keys: ["Amazon Elastic Compute Cloud"], Metrics: { UnblendedCost: { Amount: "15.10", Unit: "USD" }, UsageQuantity: { Amount: "730", Unit: "Hrs" } } },
					{ Keys: ["Amazon Simple Storage Service"], Metrics: { UnblendedCost: { Amount: "0.30", Unit: "USD" }, UsageQuantity: { Amount: "668366", Unit: "Requests" } } },
				],
			},
			{
				TimePeriod: { Start: "2026-09-01", End: "2026-10-01" },
				Groups: [{ Keys: ["Amazon Simple Storage Service"], Metrics: { UnblendedCost: { Amount: "0.037", Unit: "USD" }, UsageQuantity: { Amount: "1.259", Unit: "GB" } } }],
			},
		],
	};
	const rows = parseCostAndUsage(response);
	assert.equal(rows.length, 4);
	assert.equal(rows[0].start, "2026-09-01");
	assert.equal(rows[1].group, "Amazon Simple Storage Service");
	assert.equal(rows[1].costUsd, 65.72);
	assert.equal(rows[1].usageUnit, "GB");

	const totals = summarizeUsage(rows);
	assert.ok(Math.abs(totals.get("Amazon Simple Storage Service|GB") - 661.765) < 1e-9);
	assert.equal(totals.get("Amazon Simple Storage Service|Requests"), 668366);
	assert.equal(totals.get("Amazon Elastic Compute Cloud|Hrs"), 730);
	// GB and Requests stay in separate buckets; there is no combined quantity.
	assert.equal(totals.get("Amazon Simple Storage Service"), undefined);
});

test("log-retention evaluator accepts the audited 180/365/365 baseline only", () => {
	const check = GUARD_CHECKS.find((c) => c.id === "log-retention");
	const baseline = {
		logGroups: [
			{ logGroupName: "/ecs/bible-on-site-website", retentionInDays: 180 },
			{ logGroupName: "/ecs/bible-on-site-api", retentionInDays: 365 },
			{ logGroupName: "/ecs/bible-on-site-admin", retentionInDays: 365 },
		],
	};
	assert.equal(check.evaluate(baseline).ok, true);

	const neverExpire = structuredClone(baseline);
	delete neverExpire.logGroups[1].retentionInDays;
	const drift = check.evaluate(neverExpire);
	assert.equal(drift.ok, false);
	assert.match(drift.observed, /api=never/);

	const missing = check.evaluate({ logGroups: baseline.logGroups.slice(0, 2) });
	assert.equal(missing.ok, false);
	assert.match(missing.observed, /admin=missing/);
});

test("ecs-capacity evaluator enforces admin-only Spot and desired counts", () => {
	const check = GUARD_CHECKS.find((c) => c.id === "ecs-capacity");
	const baseline = {
		services: [
			{ serviceName: "bible-on-site-website", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-api", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-admin", capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }], desiredCount: 1, runningCount: 1 },
		],
	};
	assert.equal(check.evaluate(baseline).ok, true);

	const adminOnDemand = structuredClone(baseline);
	adminOnDemand.services[2] = { serviceName: "bible-on-site-admin", launchType: "FARGATE", desiredCount: 1, runningCount: 1 };
	assert.equal(check.evaluate(adminOnDemand).ok, false);

	const websiteSpot = structuredClone(baseline);
	websiteSpot.services[0].capacityProviderStrategy = [{ capacityProvider: "FARGATE_SPOT", weight: 1 }];
	assert.equal(check.evaluate(websiteSpot).ok, false);

	const scaled = structuredClone(baseline);
	scaled.services[1].desiredCount = 3;
	const scaledResult = check.evaluate(scaled);
	assert.equal(scaledResult.ok, false);
	assert.match(scaledResult.observed, /api=FARGATE desired=3/);
});

test("ecs-capacity reads placement from weights and bases, not membership", () => {
	const check = GUARD_CHECKS.find((c) => c.id === "ecs-capacity");
	const baseline = {
		services: [
			{ serviceName: "bible-on-site-website", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-api", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-admin", capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }], desiredCount: 1, runningCount: 1 },
		],
	};

	// A zero-weight Spot entry places no tasks; the admin strategy below is
	// effectively on-demand and must fail the exclusively-Spot guardrail.
	const inertSpot = structuredClone(baseline);
	inertSpot.services[2].capacityProviderStrategy = [
		{ capacityProvider: "FARGATE", weight: 1 },
		{ capacityProvider: "FARGATE_SPOT", weight: 0 },
	];
	assert.equal(check.evaluate(inertSpot).ok, false);

	// A nonzero on-demand base also places tasks before weighted ones.
	const basedOnDemand = structuredClone(baseline);
	basedOnDemand.services[2].capacityProviderStrategy = [
		{ capacityProvider: "FARGATE", base: 1, weight: 0 },
		{ capacityProvider: "FARGATE_SPOT", weight: 1 },
	];
	assert.equal(check.evaluate(basedOnDemand).ok, false);

	// Mixed Spot and on-demand weights are not exclusive either.
	const mixed = structuredClone(baseline);
	mixed.services[2].capacityProviderStrategy = [
		{ capacityProvider: "FARGATE", weight: 1 },
		{ capacityProvider: "FARGATE_SPOT", weight: 1 },
	];
	assert.equal(check.evaluate(mixed).ok, false);
});

test("ecs-capacity fails public services with no running task but tolerates Spot interruption on admin", () => {
	const check = GUARD_CHECKS.find((c) => c.id === "ecs-capacity");
	const baseline = {
		services: [
			{ serviceName: "bible-on-site-website", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-api", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-admin", capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }], desiredCount: 1, runningCount: 1 },
		],
	};

	const websiteDown = structuredClone(baseline);
	websiteDown.services[0].runningCount = 0;
	websiteDown.services[0].pendingCount = 1;
	const downResult = check.evaluate(websiteDown);
	assert.equal(downResult.ok, false);
	assert.match(downResult.observed, /website=FARGATE desired=1 running=0 pending=1/);

	// Spot interruptions on admin are reported, not failed.
	const adminPaused = structuredClone(baseline);
	adminPaused.services[2].runningCount = 0;
	assert.equal(check.evaluate(adminPaused).ok, true);
});

test("router, endpoint and CDN evaluators pin the audited state", () => {
	const router = GUARD_CHECKS.find((c) => c.id === "router");
	const running = { Reservations: [{ Instances: [{ State: { Name: "running" }, InstanceType: "t3.small" }] }] };
	assert.equal(router.evaluate(running).ok, true);
	assert.equal(router.evaluate({ Reservations: [{ Instances: [{ State: { Name: "running" }, InstanceType: "t3.micro" }] }] }).ok, false);
	assert.equal(router.evaluate({ Reservations: [{ Instances: [{ State: { Name: "stopped" }, InstanceType: "t3.small" }] }] }).ok, false);

	const endpoints = GUARD_CHECKS.find((c) => c.id === "vpc-endpoints");
	assert.equal(
		endpoints.evaluate({ VpcEndpoints: [{ VpcEndpointId: "vpce-0dd7903d30e03208c", State: "available" }, { VpcEndpointId: "vpce-0388b3ea36b6a3214", State: "available" }] }).ok,
		true,
	);
	assert.equal(
		endpoints.evaluate({ VpcEndpoints: [{ VpcEndpointId: "vpce-0dd7903d30e03208c", State: "available" }] }).ok,
		false,
	);

	const cdn = GUARD_CHECKS.find((c) => c.id === "cdn-caching");
	const disabled = { Distribution: { DistributionConfig: { Enabled: true, DefaultCacheBehavior: { CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" } } } };
	assert.equal(cdn.evaluate(disabled).ok, true);
	const cached = structuredClone(disabled);
	cached.Distribution.DistributionConfig.DefaultCacheBehavior.CachePolicyId = "658327ea-f89d-4fab-a63d-7e88639e58f6";
	assert.equal(cdn.evaluate(cached).ok, false);
});

test("observability evaluators report gaps without failing", () => {
	const budgets = OBSERVABILITY_CHECKS.find((c) => c.id === "budgets");
	assert.equal(budgets.evaluate({ Budgets: [] }).observed, "none configured");
	assert.equal(budgets.evaluate({ Budgets: [{}] }).observed, "1 budget(s)");
	const logging = OBSERVABILITY_CHECKS.find((c) => c.id === "assets-bucket-logging");
	assert.equal(logging.evaluate({}).observed, "disabled");
	assert.equal(logging.evaluate({ LoggingEnabled: { TargetBucket: "logs-bucket" } }).observed, "enabled -> logs-bucket");
});

/** CLI double dispatching on argv, like the production wrapper. */
function fakeAws(responses, calls = []) {
	return async (command, args) => {
		calls.push({ command, args });
		const joined = args.join(" ");
		for (const [match, response] of Object.entries(responses)) {
			if (joined.includes(match)) {
				if (response instanceof Error) throw response;
				return { stdout: JSON.stringify(response) };
			}
		}
		throw new Error(`unexpected aws call: ${joined}`);
	};
}

const HEALTHY = {
	"get-caller-identity": { Account: ACCOUNT_ID },
	"describe-log-groups": {
		logGroups: [
			{ logGroupName: "/ecs/bible-on-site-website", retentionInDays: 180 },
			{ logGroupName: "/ecs/bible-on-site-api", retentionInDays: 365 },
			{ logGroupName: "/ecs/bible-on-site-admin", retentionInDays: 365 },
		],
	},
	"describe-services": {
		services: [
			{ serviceName: "bible-on-site-website", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-api", launchType: "FARGATE", desiredCount: 1, runningCount: 1 },
			{ serviceName: "bible-on-site-admin", capacityProviderStrategy: [{ capacityProvider: "FARGATE_SPOT", weight: 1 }], desiredCount: 1, runningCount: 1 },
		],
	},
	"describe-instances": { Reservations: [{ Instances: [{ State: { Name: "running" }, InstanceType: "t3.small" }] }] },
	"describe-vpc-endpoints": {
		VpcEndpoints: [
			{ VpcEndpointId: "vpce-0dd7903d30e03208c", State: "available" },
			{ VpcEndpointId: "vpce-0388b3ea36b6a3214", State: "available" },
		],
	},
	"get-distribution": { Distribution: { DistributionConfig: { Enabled: true, DefaultCacheBehavior: { CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" } } } },
	"describe-budgets": { Budgets: [] },
	"get-anomaly-monitors": { AnomalyMonitors: [] },
	"list-bucket-metrics-configurations": {},
	"get-bucket-logging": {},
	"get-cost-and-usage": { ResultsByTime: [] },
};

test("audit verifies identity first and passes global calls through us-east-1", async () => {
	const calls = [];
	const report = await audit({ profile: "ops", months: 2, skipSpend: false }, { execute: fakeAws(HEALTHY, calls) });
	assert.equal(report.ok, true);
	assert.equal(report.account, ACCOUNT_ID);
	assert.equal(calls[0].args.join(" "), "sts get-caller-identity --output json --profile ops --region il-central-1");
	const regions = Object.fromEntries(calls.map((call) => [call.args[0], call.args[call.args.indexOf("--region") + 1]]));
	assert.equal(regions.logs, REGION);
	assert.equal(regions.ecs, REGION);
	assert.equal(regions.ec2, REGION);
	assert.equal(regions.cloudfront, GLOBAL_REGION);
	assert.equal(regions.ce, GLOBAL_REGION);
	assert.equal(regions.budgets, GLOBAL_REGION);
	for (const call of calls) {
		assert.equal(call.command, "aws");
		assert.ok(call.args.includes("--output"));
		assert.ok(call.args.includes("json"));
	}
});

test("audit refuses any account but the verified production account", async () => {
	const calls = [];
	const wrong = { ...HEALTHY, "get-caller-identity": { Account: "985796087238" } }; // nosemgrep: generic.secrets.security.detected-aws-account-id.detected-aws-account-id
	await assert.rejects(() => audit({ profile: "ops" }, { execute: fakeAws(wrong, calls) }), /Refusing to audit account 985796087238/);
	assert.equal(calls.length, 1);
});

test("guardrail drift fails the audit; observability gaps and errors do not", async () => {
	const drift = structuredClone(HEALTHY);
	drift["describe-log-groups"].logGroups[1].retentionInDays = 90;
	const denied = new Error("AccessDenied");
	denied.name = "AccessDeniedException";
	drift["describe-budgets"] = denied;
	const report = await audit({ profile: "ops", skipSpend: true }, { execute: fakeAws(drift) });
	assert.equal(report.ok, false);
	const retention = report.checks.find((c) => c.id === "log-retention");
	assert.equal(retention.ok, false);
	assert.match(retention.observed, /api=90d/);
	const budgets = report.checks.find((c) => c.id === "budgets");
	assert.equal(budgets.status, "skipped");
	assert.deepEqual(Object.keys(report.spend), []);
});

test("guardrail call errors fail the audit too", async () => {
	const broken = structuredClone(HEALTHY);
	broken["describe-services"] = new Error("ThrottlingException");
	const report = await audit({ profile: "ops", skipSpend: true }, { execute: fakeAws(broken) });
	assert.equal(report.ok, false);
	assert.equal(report.checks.find((c) => c.id === "ecs-capacity").status, "error");
});

test("--skip-spend issues no Cost Explorer call at all", async () => {
	const calls = [];
	await audit({ profile: "ops", skipSpend: true }, { execute: fakeAws(HEALTHY, calls) });
	assert.equal(calls.filter((call) => call.args[0] === "ce").length, 0);
});

test("spend queries follow NextPageToken and merge groups per period", async () => {
	const calls = [];
	// fakeAws matches on substring; emulate two pages via a stateful execute.
	let pageCalls = 0;
	const execute = async (command, args) => {
		calls.push({ command, args });
		const joined = args.join(" ");
		if (joined.includes("get-cost-and-usage")) {
			pageCalls++;
			const first = pageCalls % 2 === 1;
			return {
				stdout: JSON.stringify(
					first
						? {
								NextPageToken: "next",
								ResultsByTime: [
									{
										TimePeriod: { Start: "2026-10-01", End: "2026-11-01" },
										Groups: [{ Keys: ["Amazon S3"], Metrics: { UnblendedCost: { Amount: "10", Unit: "USD" } } }],
									},
								],
							}
						: {
								ResultsByTime: [
									{
										TimePeriod: { Start: "2026-10-01", End: "2026-11-01" },
										Groups: [{ Keys: ["Amazon EC2"], Metrics: { UnblendedCost: { Amount: "5", Unit: "USD" } } }],
									},
								],
							},
				),
			};
		}
		for (const [match, response] of Object.entries(HEALTHY)) {
			if (joined.includes(match)) return { stdout: JSON.stringify(response) };
		}
		throw new Error(`unexpected aws call: ${joined}`);
	};
	const report = await audit({ profile: "ops", months: 1 }, { execute });
	const tokenCalls = calls.filter((call) => call.args.includes("--next-page-token"));
	assert.equal(tokenCalls.length, 2); // one per query (monthly + daily)
	const groups = report.spend.monthly.rows.map((row) => row.group).sort();
	assert.deepEqual(groups, ["Amazon EC2", "Amazon S3"]);
});

test("formatReport prints every spend row without truncation", () => {
	const rows = Array.from({ length: 60 }, (_, i) => ({
		start: "2026-10-01",
		group: `svc-${i}`,
		costUsd: i,
		usageAmount: null,
		usageUnit: null,
	}));
	const text = formatReport({
		generatedAt: "2026-11-09T00:00:00.000Z",
		account: ACCOUNT_ID,
		region: REGION,
		profile: "ops",
		ok: true,
		checks: [],
		spend: { monthly: { rows } },
	});
	assert.equal((text.match(/svc-/g) ?? []).length, 60);
});

test("formatReport renders guardrail, observability and spend sections", () => {
	const report = {
		generatedAt: "2026-11-09T00:00:00.000Z",
		account: ACCOUNT_ID,
		region: REGION,
		profile: "ops",
		ok: false,
		checks: [
			{ id: "router", title: "Router", ok: false, expected: "running t3.small", observed: "stopped t3.small" },
			{ id: "budgets", title: "Budgets", observed: "none configured", recommendation: "see template" },
		],
		spend: { monthly: { rows: [{ start: "2026-10-01", group: "Amazon Simple Storage Service", costUsd: 65.72, usageAmount: 660.506, usageUnit: "GB" }] } },
	};
	const text = formatReport(report);
	assert.match(text, /## Guardrails/);
	assert.match(text, /\| Router \| DRIFT \|/);
	assert.match(text, /## Observability/);
	assert.match(text, /\$65\.72/);
	assert.match(text, /660\.506 GB/);
});

test("main prints the report and propagates the ok verdict", async () => {
	const written = [];
	const ok = await main(["--skip-spend"], { execute: fakeAws(HEALTHY), write: (line) => written.push(line) });
	assert.equal(ok, true);
	assert.match(written[0], /# AWS cost-safety audit/);
	const json = [];
	const okJson = await main(["--skip-spend", "--json"], { execute: fakeAws(HEALTHY), write: (line) => json.push(line) });
	assert.equal(okJson, true);
	assert.equal(JSON.parse(json[0]).account, ACCOUNT_ID);
	const help = [];
	assert.equal(await main(["--help"], { write: (line) => help.push(line) }), true);
	assert.ok(help[0].includes(USAGE));
});
