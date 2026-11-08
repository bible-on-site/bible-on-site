import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AuthorizeSecurityGroupIngressCommand,
	type AuthorizeSecurityGroupIngressResult,
	type EC2Client,
	RevokeSecurityGroupIngressCommand,
	type RevokeSecurityGroupIngressResult,
	type SecurityGroupRule,
} from "@aws-sdk/client-ec2";
import {
	authorizeDevSyncIngress,
	type DevSyncIngress,
	revokeDevSyncIngress,
	withDevSyncIngress,
} from "./rds-sync-access.mts";

const GROUP = "sg-0123456789abcdef0";
const CIDR = "198.51.100.7/32";
const RULE_ID = "sgr-0123456789abcdef0";

function ownedRule(overrides: Partial<SecurityGroupRule> = {}): SecurityGroupRule {
	return {
		SecurityGroupRuleId: RULE_ID,
		GroupId: GROUP,
		IsEgress: false,
		IpProtocol: "tcp",
		FromPort: 3306,
		ToPort: 3306,
		CidrIpv4: CIDR,
		Description: "dev-sync",
		...overrides,
	};
}

interface SentCommands {
	authorize: AuthorizeSecurityGroupIngressCommand["input"][];
	revoke: RevokeSecurityGroupIngressCommand["input"][];
}

function fakeEc2(
	handlers: {
		authorize?: (
			input: AuthorizeSecurityGroupIngressCommand["input"],
		) => AuthorizeSecurityGroupIngressResult;
		revoke?: (
			input: RevokeSecurityGroupIngressCommand["input"],
		) => RevokeSecurityGroupIngressResult;
	} = {},
): { client: EC2Client; sent: SentCommands } {
	const sent: SentCommands = { authorize: [], revoke: [] };
	const client = {
		send: async (command: unknown) => {
			if (command instanceof AuthorizeSecurityGroupIngressCommand) {
				sent.authorize.push(command.input);
				return (
					handlers.authorize?.(command.input) ?? {
						Return: true,
						SecurityGroupRules: [ownedRule()],
					}
				);
			}
			if (command instanceof RevokeSecurityGroupIngressCommand) {
				sent.revoke.push(command.input);
				return handlers.revoke?.(command.input) ?? { Return: true };
			}
			throw new Error(`Unexpected EC2 command: ${String(command)}`);
		},
	} as unknown as EC2Client;
	return { client, sent };
}

test("withDevSyncIngress", async (t) => {
	await t.test(
		"runs the work and revokes the created rule by rule ID, never by permission",
		async () => {
			const { client, sent } = fakeEc2();
			const result = await withDevSyncIngress(client, GROUP, CIDR, async () => "done");
			assert.equal(result, "done");
			assert.equal(sent.authorize.length, 1);
			assert.deepEqual(sent.revoke, [
				{ GroupId: GROUP, SecurityGroupRuleIds: [RULE_ID] },
			]);
		},
	);

	await t.test(
		"authorizes tcp/3306 for the operator /32 with the dev-sync description",
		async () => {
			const { client, sent } = fakeEc2();
			await withDevSyncIngress(client, GROUP, CIDR, async () => {});
			const [input] = sent.authorize;
			assert.equal(input.GroupId, GROUP);
			assert.deepEqual(input.IpPermissions, [
				{
					IpProtocol: "tcp",
					FromPort: 3306,
					ToPort: 3306,
					IpRanges: [{ CidrIp: CIDR, Description: "dev-sync" }],
				},
			]);
		},
	);

	await t.test(
		"treats a duplicate grant as borrowed access and leaves the foreign rule intact",
		async () => {
			const foreign = ownedRule({
				SecurityGroupRuleId: "sgr-fffffffffffffffff",
				Description: "operator access",
			});
			const sgRules = [foreign];
			const { client, sent } = fakeEc2({
				authorize: () => {
					throw new Error(
						"InvalidPermission.Duplicate: the specified rule already exists",
					);
				},
				revoke: (input) => {
					const removed = new Set(input.SecurityGroupRuleIds ?? []);
					const remaining = sgRules.filter(
						(rule) => !removed.has(rule.SecurityGroupRuleId ?? ""),
					);
					sgRules.splice(0, sgRules.length, ...remaining);
					return { Return: true };
				},
			});
			let worked = false;
			const result = await withDevSyncIngress(client, GROUP, CIDR, async () => {
				worked = true;
				return "synced";
			});
			assert.equal(result, "synced");
			assert.equal(worked, true);
			// The borrowed rule is never revoked — not even by a permission match.
			assert.equal(sent.revoke.length, 0);
			assert.deepEqual(sgRules, [foreign]);
		},
	);

	await t.test(
		"revokes every rule ID the grant receipt reports",
		async () => {
			const secondId = "sgr-11111111111111111";
			const { client, sent } = fakeEc2({
				authorize: () => ({
					Return: true,
					SecurityGroupRules: [
						ownedRule(),
						ownedRule({ SecurityGroupRuleId: secondId }),
					],
				}),
			});
			await withDevSyncIngress(client, GROUP, CIDR, async () => {});
			assert.deepEqual(sent.revoke, [
				{ GroupId: GROUP, SecurityGroupRuleIds: [RULE_ID, secondId] },
			]);
		},
	);

	await t.test(
		"still revokes the owned rule when the work fails",
		async () => {
			const { client, sent } = fakeEc2();
			const failure = new Error("mysqldump failed");
			await assert.rejects(
				withDevSyncIngress(client, GROUP, CIDR, async () => {
					throw failure;
				}),
				(err) => err === failure,
			);
			assert.deepEqual(sent.revoke, [
				{ GroupId: GROUP, SecurityGroupRuleIds: [RULE_ID] },
			]);
		},
	);

	await t.test(
		"propagates a non-duplicate grant failure without work or revoke",
		async () => {
			const { client, sent } = fakeEc2({
				authorize: () => {
					throw new Error("UnauthorizedOperation");
				},
			});
			await assert.rejects(
				withDevSyncIngress(client, GROUP, CIDR, async () => {
					throw new Error("work must not run");
				}),
				/UnauthorizedOperation/,
			);
			assert.equal(sent.revoke.length, 0);
		},
	);

	await t.test(
		"fails without touching the group when the grant returns no identifiable rule",
		async () => {
			for (const response of [
				{ Return: false },
				{ Return: true },
				{ Return: true, SecurityGroupRules: [] },
				{
					Return: true,
					SecurityGroupRules: [ownedRule({ SecurityGroupRuleId: undefined })],
				},
			]) {
				const { client, sent } = fakeEc2({ authorize: () => response });
				await assert.rejects(
					withDevSyncIngress(client, GROUP, CIDR, async () => {
						throw new Error("work must not run");
					}),
					/ingress|rule/i,
				);
				assert.equal(sent.revoke.length, 0);
			}
		},
	);

	await t.test(
		"tolerates an already-removed owned rule so repeated cleanup is harmless",
		async () => {
			const { client, sent } = fakeEc2({
				revoke: () => {
					throw new Error("InvalidSecurityGroupRuleId.NotFound");
				},
			});
			const result = await withDevSyncIngress(client, GROUP, CIDR, async () => "done");
			assert.equal(result, "done");
			assert.equal(sent.revoke.length, 1);
		},
	);

	await t.test(
		"warns when AWS does not confirm the owned rule's removal",
		async (t) => {
			const warn = t.mock.method(console, "warn", () => {});
			const { client, sent } = fakeEc2({
				revoke: () => ({ Return: false }),
			});
			const result = await withDevSyncIngress(client, GROUP, CIDR, async () => "done");
			assert.equal(result, "done");
			assert.equal(sent.revoke.length, 1);
			assert.equal(warn.mock.calls.length, 1);
			assert.match(String(warn.mock.calls[0].arguments[0]), /sgr-/);
		},
	);

	await t.test(
		"warns but does not fail the finished sync when revoke errors",
		async (t) => {
			const warn = t.mock.method(console, "warn", () => {});
			const { client, sent } = fakeEc2({
				revoke: () => {
					throw new Error("ServiceUnavailable");
				},
			});
			const result = await withDevSyncIngress(client, GROUP, CIDR, async () => "done");
			assert.equal(result, "done");
			assert.equal(sent.revoke.length, 1);
			assert.equal(warn.mock.calls.length, 1);
			assert.match(String(warn.mock.calls[0].arguments[0]), /RULE|sgr-/i);
		},
	);
});

test("revokeDevSyncIngress", async (t) => {
	await t.test(
		"makes no AWS call when nothing is owned or access was borrowed",
		async () => {
			const { client, sent } = fakeEc2();
			await revokeDevSyncIngress(client, undefined);
			await revokeDevSyncIngress(client, { kind: "borrowed" });
			assert.equal(sent.authorize.length, 0);
			assert.equal(sent.revoke.length, 0);
		},
	);

	await t.test(
		"a second cleanup of the same owned rule resolves without throwing",
		async () => {
			let revocations = 0;
			const { client, sent } = fakeEc2({
				revoke: () => {
					revocations += 1;
					if (revocations > 1)
						throw new Error("InvalidSecurityGroupRuleId.NotFound");
					return { Return: true };
				},
			});
			const ingress = await authorizeDevSyncIngress(client, GROUP, CIDR);
			await revokeDevSyncIngress(client, ingress);
			await revokeDevSyncIngress(client, ingress);
			assert.equal(sent.revoke.length, 2);
		},
	);
});

test("authorizeDevSyncIngress", async (t) => {
	await t.test("reports the created rule as owned", async () => {
		const { client } = fakeEc2();
		const ingress = await authorizeDevSyncIngress(client, GROUP, CIDR);
		assert.deepEqual(ingress, {
			kind: "owned",
			groupId: GROUP,
			ruleIds: [RULE_ID],
		});
	});

	await t.test("reports a pre-existing matching rule as borrowed", async () => {
		const { client } = fakeEc2({
			authorize: () => {
				throw new Error("InvalidPermission.Duplicate");
			},
		});
		const ingress: DevSyncIngress = await authorizeDevSyncIngress(
			client,
			GROUP,
			CIDR,
		);
		assert.deepEqual(ingress, { kind: "borrowed" });
	});
});
