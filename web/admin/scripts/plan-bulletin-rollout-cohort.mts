/**
 * Plans the reviewed original-cohort enrollment (#3382); never applies it.
 *
 * The snapshot is a private file, outside the repository: a JSON array of
 * {"subscriberId": number, "email": string, "consentStatus": string} entries
 * in the authoritative original signup/import order. It is produced by
 * reconciling the private original list with the subscriber table. Only
 * aggregate counts are printed — no addresses reach stdout or the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	bulletinCohortSql,
	type CohortSnapshotMember,
	planBulletinCohort,
} from "../src/server/bulletin-rollout-plan";

const { values } = parseArgs({
	options: {
		snapshot: { type: "string" },
		output: { type: "string" },
	},
});
if (!values.snapshot || !values.output)
	throw new Error(
		"Usage: bun run scripts/plan-bulletin-rollout-cohort.mts --snapshot private-cohort.json --output private-output-directory",
	);
const snapshot = JSON.parse(readFileSync(resolve(values.snapshot), "utf8"));
if (!Array.isArray(snapshot))
	throw new Error("Expected an original cohort array in original order");
const members = snapshot as CohortSnapshotMember[];
const plan = planBulletinCohort(members);
const directory = resolve(values.output);
mkdirSync(directory, { recursive: true });
writeFileSync(
	resolve(directory, "cohort-plan.json"),
	JSON.stringify(plan, null, 2),
	{ flag: "wx" },
);
writeFileSync(
	resolve(directory, "enroll.sql"),
	bulletinCohortSql(members, plan),
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		total: plan.total,
		pending: plan.pending,
		admitted: plan.admitted,
		excluded: plan.excluded,
	}),
);
