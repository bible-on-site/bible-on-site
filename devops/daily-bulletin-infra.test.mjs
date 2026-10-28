import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { YAML } from "bun";

const template = YAML.parse(
	readFileSync(
		new URL(
			"../docs/aws/cloudformation/daily-bulletin-ses.yaml",
			import.meta.url,
		),
		"utf8",
	),
);

// Bun preserves the scalar values of the !Ref and !GetAtt intrinsic tags.
// SQS rejects a policy statement with multiple resources or another queue's ARN.
function assertQueuePolicyScope(resource) {
	assert.equal(resource.Type, "AWS::SQS::QueuePolicy");
	const { Queues, PolicyDocument } = resource.Properties;
	assert.equal(Queues.length, 1, "a policy must attach to exactly one queue");
	const expectedArn = `${Queues[0]}.Arn`;
	for (const statement of PolicyDocument.Statement) {
		assert.equal(
			statement.Resource,
			expectedArn,
			"each SQS statement must name only the queue receiving the policy",
		);
	}
}

test("every SQS queue has a separate policy scoped only to its own ARN", () => {
	const queues = Object.entries(template.Resources)
		.filter(([, resource]) => resource.Type === "AWS::SQS::Queue")
		.map(([name]) => name);
	const policies = Object.values(template.Resources).filter(
		(resource) => resource.Type === "AWS::SQS::QueuePolicy",
	);
	assert.equal(policies.length, queues.length);
	for (const policy of policies) assertQueuePolicyScope(policy);
	assert.deepEqual(
		policies.flatMap((policy) => policy.Properties.Queues).sort(),
		queues.sort(),
		"every queue must be protected exactly once",
	);
});

test("scope check rejects the deployment's multi-resource and cross-queue failure", () => {
	const policy = structuredClone(template.Resources.BulletinWorkerQueuePolicy);
	policy.Properties.PolicyDocument.Statement[0].Resource = [
		"BulletinWorkerQueue.Arn",
		"BulletinWorkerDeadLetterQueue.Arn",
	];
	assert.throws(() => assertQueuePolicyScope(policy), /each SQS statement/);
	policy.Properties.PolicyDocument.Statement[0].Resource =
		"BulletinWorkerDeadLetterQueue.Arn";
	assert.throws(() => assertQueuePolicyScope(policy), /each SQS statement/);
});

test("only the worker queue accepts the trusted SNS topic and both queues require TLS", () => {
	const worker = template.Resources.BulletinWorkerQueuePolicy.Properties;
	const deadLetter =
		template.Resources.BulletinWorkerDeadLetterQueuePolicy.Properties;
	const allows = worker.PolicyDocument.Statement.filter(
		(statement) => statement.Effect === "Allow",
	);
	assert.equal(allows.length, 1);
	assert.equal(allows[0].Principal.Service, "sns.amazonaws.com");
	assert.equal(allows[0].Action, "sqs:SendMessage");
	assert.equal(
		allows[0].Condition.ArnEquals["aws:SourceArn"],
		"BulletinEventsTopic",
	);
	assert.equal(
		allows[0].Condition.StringEquals["aws:SourceAccount"],
		"AWS::AccountId",
	);
	assert.equal(
		deadLetter.PolicyDocument.Statement.filter(
			(statement) => statement.Effect === "Allow",
		).length,
		0,
		"the DLQ must not grant SNS publishing",
	);
	for (const policy of [worker, deadLetter]) {
		const tls = policy.PolicyDocument.Statement.find(
			(statement) => statement.Effect === "Deny",
		);
		assert.ok(tls, "every queue needs an insecure-transport deny");
		assert.equal(tls.Principal, "*");
		assert.equal(tls.Action, "sqs:*");
		assert.equal(tls.Condition.Bool["aws:SecureTransport"], "false");
	}
});

test("DNS additions are limited to SES DKIM and a non-enforcing DMARC policy", () => {
	const records = Object.values(template.Resources).filter(
		(resource) => resource.Type === "AWS::Route53::RecordSet",
	);
	assert.equal(records.length, 4);
	assert.equal(
		records.filter((record) => record.Properties.Type === "CNAME").length,
		3,
	);
	const policy = template.Resources.BulletinDmarcRecord.Properties;
	// biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation resolves this !Sub expression.
	assert.equal(policy.Name, "_dmarc.${DomainName}");
	assert.equal(policy.Type, "TXT");
	assert.deepEqual(policy.ResourceRecords, [
		'"v=DMARC1; p=none; adkim=r; aspf=r"',
	]);
	assert.ok(
		records.every((record) =>
			["CNAME", "TXT"].includes(record.Properties.Type),
		),
	);
});

test("email images preserve their original sources and published content hashes", () => {
	const base = new URL("../", import.meta.url);
	const folder = new URL("web/bulletin/assets/email/", base);
	const manifest = JSON.parse(
		readFileSync(new URL("manifest.json", folder), "utf8"),
	);
	assert.equal(manifest.assets.length, 5);
	const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
	for (const asset of manifest.assets) {
		const bytes = readFileSync(new URL(asset.file, folder));
		const source = readFileSync(new URL(asset.sourcePath, base));
		assert.equal(hash(bytes), asset.sha256);
		assert.equal(hash(source), asset.sourceSha256);
		assert.equal(bytes.length, asset.bytes);
		assert.ok(asset.file.includes(asset.sha256.slice(0, 12)));
		assert.equal(asset.s3Key, `branding/daily-bulletin/${asset.file}`);
		assert.equal(
			asset.url,
			`https://bible-on-site-assets.s3.il-central-1.amazonaws.com/${asset.s3Key}`,
		);
		if (asset.id === "logo-header") {
			assert.deepEqual(bytes, source, "use the exact original wordmark");
		} else {
			assert.equal(bytes.subarray(1, 4).toString(), "PNG");
			assert.equal(bytes.readUInt32BE(16), 36);
			assert.equal(bytes.readUInt32BE(20), 36);
		}
	}
});
