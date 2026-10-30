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

function assertSesSendScope(statement) {
	const arn = `arn:\${AWS::Partition}:ses:\${AWS::Region}:\${AWS::AccountId}:`;
	assert.equal(statement.Effect, "Allow");
	assert.equal(statement.Action, "ses:SendEmail", "no additional send APIs");
	assert.deepEqual(statement.Resource, [
		`${arn}identity/\${BulletinEmailIdentity}`,
		`${arn}configuration-set/\${BulletinConfigurationSet}`,
		`${arn}contact-list/\${BulletinContactList}`,
	], "sending with list management needs exactly these three resources");
	assert.deepEqual(statement.Condition, {
		StringEquals: { "ses:FromAddress": "FromAddress" },
	}, "the exact sender restriction must remain");
}

const sendStatement = template.Resources.BulletinAdminRuntimePolicy.Properties
	.PolicyDocument.Statement.find(statement => statement.Sid === "SendFromBulletinIdentity");

test("SES sending permits list management only for the bulletin resources and sender", () => {
	assertSesSendScope(sendStatement);
});

test("SES scope guard rejects the missing list grant, wildcard resources and broader send APIs", () => {
	const missingList = structuredClone(sendStatement);
	missingList.Resource.pop();
	assert.throws(() => assertSesSendScope(missingList), /exactly these three resources/);
	const wildcard = structuredClone(sendStatement);
	wildcard.Resource.push("*");
	assert.throws(() => assertSesSendScope(wildcard), /exactly these three resources/);
	const rawSend = structuredClone(sendStatement);
	rawSend.Action = ["ses:SendEmail", "ses:SendRawEmail"];
	assert.throws(() => assertSesSendScope(rawSend), /no additional send APIs/);
	const anySender = structuredClone(sendStatement);
	delete anySender.Condition;
	assert.throws(() => assertSesSendScope(anySender), /exact sender restriction/);
});

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
	assert.equal(manifest.assets.length, 6);
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

const whatsappTemplate = YAML.parse(
	readFileSync(
		new URL(
			"../docs/aws/cloudformation/daily-bulletin-whatsapp.yaml",
			import.meta.url,
		),
		"utf8",
	),
);

test("optional WhatsApp policy grants only exact token injection to the existing execution role", () => {
	assert.deepEqual(Object.keys(whatsappTemplate.Resources), [
		"WhatsAppTokenInjectionPolicy",
	]);
	const resource = whatsappTemplate.Resources.WhatsAppTokenInjectionPolicy;
	assert.equal(resource.Type, "AWS::IAM::Policy");
	assert.deepEqual(resource.Properties.Roles, ["AdminExecutionRoleName"]);
	assert.equal(
		whatsappTemplate.Parameters.AdminExecutionRoleName.Default,
		"ecsTaskExecutionRole",
	);
	assert.equal(resource.Properties.PolicyDocument.Statement.length, 1);
	const statement = resource.Properties.PolicyDocument.Statement[0];
	assert.equal(statement.Effect, "Allow");
	assert.deepEqual(statement.Action, ["ssm:GetParameters"]);
	assert.equal(
		statement.Resource,
		`arn:\${AWS::Partition}:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/bible-on-site-whatsapp-api-token`,
	);
	assert.equal(
		whatsappTemplate.Outputs.ApiTokenParameterArn.Value,
		statement.Resource,
	);
	assert.equal(
		whatsappTemplate.Outputs.ApiTokenContainerVariable.Value,
		"BULLETIN_WHATSAPP_API_TOKEN",
	);
});

const telegramTemplate = YAML.parse(
	readFileSync(
		new URL(
			"../docs/aws/cloudformation/daily-bulletin-telegram.yaml",
			import.meta.url,
		),
		"utf8",
	),
);

test("Telegram grants only one parameter read to the existing execution role", () => {
	assert.deepEqual(Object.keys(telegramTemplate.Parameters), [
		"AdminExecutionRoleName",
	]);
	assert.equal(
		telegramTemplate.Parameters.AdminExecutionRoleName.Default,
		"ecsTaskExecutionRole",
	);
	const resources = Object.values(telegramTemplate.Resources);
	assert.equal(resources.length, 1, "no token, task, role or queue creation");
	const [policy] = resources;
	assert.equal(policy.Type, "AWS::IAM::Policy");
	assert.deepEqual(policy.Properties.Roles, ["AdminExecutionRoleName"]);
	const statements = policy.Properties.PolicyDocument.Statement;
	assert.equal(statements.length, 1);
	assert.equal(statements[0].Effect, "Allow");
	assert.deepEqual(statements[0].Action, ["ssm:GetParameters"]);
	assert.equal(
		statements[0].Resource,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: CloudFormation resolves this !Sub expression.
		"arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/bible-on-site-telegram-bot-token",
	);
	assert.equal(
		telegramTemplate.Outputs.BotTokenParameterArn.Value,
		statements[0].Resource,
	);
	assert.equal(
		telegramTemplate.Outputs.BotTokenContainerVariable.Value,
		"BULLETIN_TELEGRAM_BOT_TOKEN",
	);
});

test("the study-day schedule starts disabled, uses Jerusalem 10AM and only the existing queues", () => {
	const schedule = YAML.parse(
		readFileSync(
			new URL(
				"../docs/aws/cloudformation/daily-bulletin-schedule.yaml",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.deepEqual(
		Object.values(schedule.Resources)
			.map((resource) => resource.Type)
			.sort(),
		[
			"AWS::IAM::Role",
			"AWS::Scheduler::Schedule",
			"AWS::Scheduler::ScheduleGroup",
		].sort(),
	);
	assert.equal(schedule.Parameters.ScheduleState.Default, "DISABLED");
	const properties = schedule.Resources.Schedule.Properties;
	assert.equal(properties.ScheduleExpression, "cron(0 10 ? * SUN-THU *)");
	assert.equal(properties.ScheduleExpressionTimezone, "Asia/Jerusalem");
	// CloudFormation's Arn reader loses the custom GroupName after creation.
	assert.equal(
		schedule.Outputs.ScheduleArn.Value,
		`arn:\${AWS::Partition}:scheduler:\${AWS::Region}:\${AWS::AccountId}:schedule/\${ScheduleGroup}/\${Schedule}`,
	);
	assert.equal(properties.FlexibleTimeWindow.Mode, "OFF");
	assert.deepEqual(JSON.parse(properties.Target.Input), {
		kind: "bulletin.schedule",
		scheduledAt: "<aws.scheduler.scheduled-time>",
	});
	assert.equal(properties.Target.RetryPolicy.MaximumRetryAttempts, 0);
	const role = schedule.Resources.SchedulerRole.Properties;
	const trust = role.AssumeRolePolicyDocument.Statement[0];
	assert.equal(trust.Principal.Service, "scheduler.amazonaws.com");
	assert.deepEqual(trust.Condition, {
		StringEquals: { "aws:SourceAccount": "AWS::AccountId" },
		ArnEquals: { "aws:SourceArn": "ScheduleGroup.Arn" },
	});
	assert.deepEqual(role.Policies[0].PolicyDocument.Statement, [
		{
			Effect: "Allow",
			Action: "sqs:SendMessage",
			Resource: ["WorkerQueueArn", "DeadLetterQueueArn"],
		},
	]);
	for (const name of ["WorkerQueueArn", "DeadLetterQueueArn"]) {
		assert.deepEqual(schedule.Parameters[name].AllowedValues, [
			schedule.Parameters[name].Default,
		]);
	}
});
