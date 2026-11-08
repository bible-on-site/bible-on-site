/**
 * Owned RDS ingress for the local `sync-from-prod` and `check-dev-db-freshness`
 * flows in setup-dev-env.mts.
 *
 * This is the SDK counterpart of github/ci/rds-build-access.mjs's ownership
 * discipline, adapted to local runs that have no CI build identity: an
 * invocation revokes only the rule its own authorize call created, identified
 * by the returned SecurityGroupRuleId. A matching rule that already existed
 * (InvalidPermission.Duplicate) is borrowed access — another operator or tool
 * owns it — and is never revoked, so foreign rules survive the sync intact.
 */
import {
	AuthorizeSecurityGroupIngressCommand,
	type AuthorizeSecurityGroupIngressResult,
	type EC2Client,
	type IpPermission,
	RevokeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";

const DEV_SYNC_TAG = "dev-sync";
const MYSQL_PORT = 3306;
const RULE_ID_PATTERN = /^sgr-[0-9a-f]+$/;

/** The access an invocation holds on the prod RDS security group. */
export type DevSyncIngress =
	| {
			/** Created by this invocation — only these rule IDs may be revoked. */
			kind: "owned";
			groupId: string;
			ruleIds: string[];
	  }
	| {
			/** A matching rule already existed; it belongs to someone else. */
			kind: "borrowed";
	  };

/** tcp/3306 from the operator's /32, described so leftovers stay recognizable. */
function devSyncPermission(cidr: string): IpPermission {
	return {
		IpProtocol: "tcp",
		FromPort: MYSQL_PORT,
		ToPort: MYSQL_PORT,
		IpRanges: [{ CidrIp: cidr, Description: DEV_SYNC_TAG }],
	};
}

/**
 * Extracts the identities this authorize call created. The response's
 * SecurityGroupRules are exactly the rules it added, so their IDs are the only
 * revocation-safe handle — revoking by permission could delete a foreign rule
 * that happens to match.
 */
function createdRuleIds(
	response: AuthorizeSecurityGroupIngressResult,
	groupId: string,
): string[] {
	if (response.Return === false)
		throw new Error("AWS did not confirm the RDS ingress rule");
	const ruleIds = (response.SecurityGroupRules ?? []).map(
		(rule) => rule.SecurityGroupRuleId ?? "",
	);
	if (ruleIds.length === 0 || ruleIds.some((id) => !RULE_ID_PATTERN.test(id)))
		throw new Error(
			`RDS ingress was authorized without an identifiable rule — check ${groupId} for a leftover '${DEV_SYNC_TAG}' rule`,
		);
	return ruleIds;
}

/**
 * Grants MySQL ingress for `cidr` and returns the owned handle, or `borrowed`
 * when a matching rule already exists. A rule stranded by an interrupted run
 * also surfaces as Duplicate and is borrowed — it then serves this run and
 * stays behind for the next, exactly as other operators' rules do.
 */
export async function authorizeDevSyncIngress(
	ec2: EC2Client,
	groupId: string,
	cidr: string,
): Promise<DevSyncIngress> {
	console.info("Authorizing RDS security group ingress for your IP...");
	try {
		const response = await ec2.send(
			new AuthorizeSecurityGroupIngressCommand({
				GroupId: groupId,
				IpPermissions: [devSyncPermission(cidr)],
			}),
		);
		return {
			kind: "owned",
			groupId,
			ruleIds: createdRuleIds(response, groupId),
		};
	} catch (error) {
		if (!String(error).includes("InvalidPermission.Duplicate")) throw error;
		console.info(
			`  ${cidr} already has a matching ingress rule — borrowing it; cleanup will leave it intact.`,
		);
		return { kind: "borrowed" };
	}
}

/**
 * Revokes exactly the rule this invocation created — by SecurityGroupRuleId,
 * never by permission, so a borrowed or foreign rule is never touched. A rule
 * that is already gone counts as cleaned; other failures warn with the rule
 * ID so a finished sync still reports the leftover for manual removal.
 */
export async function revokeDevSyncIngress(
	ec2: EC2Client,
	ingress: DevSyncIngress | undefined,
): Promise<void> {
	if (!ingress || ingress.kind === "borrowed") {
		console.info("No owned RDS ingress rule — nothing to revoke.");
		return;
	}
	console.info(
		`Revoking owned RDS ingress rule(s): ${ingress.ruleIds.join(", ")}`,
	);
	try {
		const response = await ec2.send(
			new RevokeSecurityGroupIngressCommand({
				GroupId: ingress.groupId,
				SecurityGroupRuleIds: ingress.ruleIds,
			}),
		);
		if (response.Return === false) {
			console.warn(
				`AWS did not confirm removal of ${ingress.ruleIds.join(", ")} on ${ingress.groupId} — remove manually.`,
			);
		}
	} catch (error) {
		if (String(error).includes("InvalidSecurityGroupRuleId.NotFound")) {
			console.info("  Owned rule already removed — nothing left to revoke.");
			return;
		}
		console.warn(
			`Revoke ingress failed (remove ${ingress.ruleIds.join(", ")} on ${ingress.groupId} manually):`,
			error,
		);
	}
}

/**
 * Runs `work` while holding RDS ingress: grants access, runs the callback,
 * then revokes exactly what the grant created — even when `work` throws.
 * Single grant/cleanup pairing shared by the sync and the freshness probe so
 * neither can strand an owned rule or over-revoke a borrowed one.
 */
export async function withDevSyncIngress<T>(
	ec2: EC2Client,
	groupId: string,
	cidr: string,
	work: () => Promise<T>,
): Promise<T> {
	const ingress = await authorizeDevSyncIngress(ec2, groupId, cidr);
	try {
		return await work();
	} finally {
		await revokeDevSyncIngress(ec2, ingress);
	}
}
