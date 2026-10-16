import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ghApi } from "./gh-api.mjs";

/**
 * Microsoft Store flight-capacity recovery.
 *
 * Partner Center caps each app at 25 package flights. This automation deletes
 * old flights before every deploy (`flights list` + `flights delete`), but the
 * Dev Center `listflights` endpoint started answering "the application has no
 * flights" in October 2026 even while flights clearly existed — create calls
 * then failed with "You've created the maximum number of package flights"
 * (app CD runs 38092403996-116585562753, #2221).
 *
 * When the listing endpoint cannot enumerate flights, the only flight IDs the
 * automation still knows are the ones it created itself — and those IDs are
 * recorded in this repository's own CD job logs (`"FlightId": "..."` from the
 * CLI JSON answer and our `Created flight with ID:` / `Deploying to flight:`
 * lines). This module harvests them so the deploy target can delete the
 * oldest and make room.
 */

/** `"FlightId": "uuid"` — the CLI's JSON answer for a created flight. */
const createdFlightPattern =
	/"FlightId"\s*:\s*"([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})"/gi;

/**
 * Our own `Created flight with ID:` line. `Deploying to flight:` is
 * deliberately not harvested — it also fires for a caller-supplied
 * --ms-store-flight-id, which CI did not create and must not delete.
 */
const loggedFlightPattern =
	/Created flight with ID:\s*([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})/gi;

/**
 * Extract every flight ID a Microsoft Store deploy job's log text records, in
 * log order (the JSON answer arrives before our own log lines for the same
 * flight, so ordering follows first appearance). Ids are lower-cased and
 * de-duplicated — a flight logged on several attempts appears once.
 */
export function extractFlightIds(logText) {
	if (typeof logText !== "string" || logText.length === 0) return [];
	const matches = [];
	for (const pattern of [createdFlightPattern, loggedFlightPattern])
		for (const match of logText.matchAll(pattern))
			matches.push({ index: match.index, id: match[1].toLowerCase() });
	matches.sort((a, b) => a.index - b.index);
	return [...new Set(matches.map(({ id }) => id))];
}

// Job logs contain the runner's ANSI escape sequences; gh api refuses to
// print them without --allow-escape-sequences.
const fetchLog = (endpoint) =>
	execFileSync("gh", ["api", endpoint, "--allow-escape-sequences"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

/**
 * Collect the flight IDs this repository's CD workflow created, oldest first,
 * by scanning recent `Deploy to Microsoft Store` job logs. Jobs are scanned
 * regardless of conclusion: a run whose flight-create output went unparsed
 * (e.g. CD run 168's verbose-output parse bug) still wrote the created
 * `"FlightId"` into its log, and that flight is exactly the kind of leaked
 * flight the recovery must be able to delete.
 *
 * `api`/`apiText` are injectable so tests never touch the network.
 */
export async function harvestDeployedFlightIds({
	repo,
	workflowFile = "cd-app.yml",
	jobName = "Deploy to Microsoft Store",
	maxPages = 3,
	api = ghApi,
	apiText = fetchLog,
} = {}) {
	if (!repo) throw new Error("harvestDeployedFlightIds requires `repo`");
	// One page of recent runs is not enough: a flight created before the
	// window can still occupy a cap slot and its ID survives in the retained
	// job log. Follow the listing until the pages run dry or the bound hits.
	const listed = [];
	for (let page = 1; page <= maxPages; page++) {
		const listing = await api(
			`repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=100&status=completed&page=${page}`,
		);
		const batch = listing?.workflow_runs ?? [];
		listed.push(...batch);
		if (batch.length < 100) break;
	}
	const seenRuns = new Set();
	const runs = listed
		.filter((run) => Number.isSafeInteger(run?.id))
		.filter((run) => !seenRuns.has(run.id) && seenRuns.add(run.id))
		// API returns newest first; scanning oldest first keeps flight IDs in
		// creation order so the oldest flight is deleted first.
		.reverse();
	const seen = new Set();
	const flightIds = [];
	let scannedJobs = 0;
	for (const run of runs) {
		let jobs;
		try {
			jobs = await api(
				`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100&filter=all`,
			);
		} catch (error) {
			console.error(`Skipping run ${run.id}: ${error.message}`);
			continue;
		}
		for (const job of jobs?.jobs ?? []) {
			if (job?.name !== jobName || !Number.isSafeInteger(job?.id)) continue;
			scannedJobs += 1;
			let logText;
			try {
				logText = await apiText(
					`repos/${repo}/actions/jobs/${job.id}/logs`,
				);
			} catch (error) {
				console.error(
					`Skipping job log ${job.id} (run ${run.id}): ${error.message}`,
				);
				continue;
			}
			for (const id of extractFlightIds(logText))
				if (!seen.has(id)) {
					seen.add(id);
					flightIds.push(id);
				}
		}
	}
	return { flightIds, scannedRuns: runs.length, scannedJobs };
}

const isMain =
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
	const repo =
		process.env.GITHUB_REPOSITORY ?? process.argv[2] ?? "";
	if (!repo || !repo.includes("/")) {
		console.error(
			"Usage: ms-store-flights.mjs [owner/repo] — GITHUB_REPOSITORY or an explicit repo argument is required",
		);
		process.exit(1);
	}
	try {
		const result = await harvestDeployedFlightIds({ repo });
		// The deploy target consumes stdout as JSON; diagnostics stay on stderr.
		console.log(
			JSON.stringify({
				flightIds: result.flightIds,
				scannedRuns: result.scannedRuns,
				scannedJobs: result.scannedJobs,
			}),
		);
	} catch (error) {
		console.error(`Flight history harvest failed: ${error.message}`);
		process.exit(1);
	}
}
