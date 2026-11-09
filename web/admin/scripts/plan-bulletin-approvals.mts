/** Prepare an explicit owner-authorized database operation; never applies it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	bulletinApprovalSql,
	planBulletinApprovals,
} from "../src/server/bulletin-approval-plan";

const { values } = parseArgs({
	options: {
		snapshot: { type: "string" },
		output: { type: "string" },
	},
});
if (!values.snapshot || !values.output)
	throw new Error(
		"Usage: bun run scripts/plan-bulletin-approvals.mts --snapshot private-snapshot.json --output private-output-directory",
	);
const snapshot = JSON.parse(readFileSync(resolve(values.snapshot), "utf8"));
if (!Array.isArray(snapshot))
	throw new Error("Expected an article snapshot array");
const plan = planBulletinApprovals(snapshot);
if (plan.changes.length) {
	const directory = resolve(values.output);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		resolve(directory, "plan.json"),
		JSON.stringify(plan, null, 2),
		{ flag: "wx" },
	);
	writeFileSync(
		resolve(directory, "approve.sql"),
		bulletinApprovalSql(plan.changes),
		{ flag: "wx" },
	);
	writeFileSync(
		resolve(directory, "rollback.sql"),
		bulletinApprovalSql(plan.changes, true),
		{ flag: "wx" },
	);
}
console.log(
	JSON.stringify({
		articles: snapshot.length,
		written: plan.written,
		excluded: plan.excluded,
		changes: plan.changes.length,
	}),
);
