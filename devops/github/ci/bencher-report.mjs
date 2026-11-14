import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pending = (check) => check.status !== "completed" && check.conclusion == null;

/** Bencher can exit zero after failing to complete its GitHub check (#3276). */
export async function runBencherReport(context, io) {
	const before = new Set((await io.listChecks()).map((check) => check.id));
	const result = io.run();
	const created = (await io.listChecks()).filter((check) =>
		!before.has(check.id) && check.head_sha === context.checkSha
		&& check.app?.slug === "github-actions"
		&& check.name === `Bencher Report (${context.project})`);
	if (created.length !== 1) {
		throw new Error(`Expected one new Bencher check for this invocation; found ${created.length}`);
	}
	const check = created[0];
	let mutationAttempted = false;
	try {
		if (result.error || result.status !== 0) {
			throw new Error(`Bencher command failed (${result.error?.message ?? result.status})`);
		}
		const urls = [...result.stdout.matchAll(/View report:\s+(https:\/\/[^\s]+)/gu)];
		if (urls.length !== 1) throw new Error("Bencher did not print exactly one report URL");
		const url = new URL(urls[0][1]);
		const match = /^\/console\/projects\/([^/]+)\/reports\/([a-f\d-]{36})$/iu.exec(url.pathname);
		if (url.origin !== "https://bencher.dev" || !match || match[1] !== context.project) {
			throw new Error("Bencher report URL does not identify the expected project");
		}
		const report = await io.fetchReport(match[2]);
		if (report.uuid !== match[2] || report.project?.slug !== context.project
			|| report.branch?.name !== context.branch
			|| report.branch?.head?.version?.hash !== context.testedSha
			|| !Array.isArray(report.alerts)
			|| report.counts?.alerts?.total !== report.alerts.length
			|| !report.counts?.results?.some((iteration) => iteration.lines > 0)
			|| !check.external_id?.startsWith(`bencher:${report.project?.uuid}:`)) {
			throw new Error("Bencher report/check identity or benchmark evidence does not match this run");
		}
		// Match Bencher's has_alert(): every alert in this report affects the check.
		const conclusion = report.alerts.length > 0 ? "failure" : "success";
		if (!pending(check)) {
			if (check.conclusion !== conclusion || !check.external_id.includes(`:${report.uuid}:`)) {
				throw new Error("Completed Bencher check disagrees with its report");
			}
			return { id: check.id, conclusion, repaired: false };
		}
		mutationAttempted = true;
		const updated = await io.updateCheck(check.id, {
			status: "completed",
			conclusion,
			details_url: url.href,
			external_id: check.external_id.replace(/^bencher:([^:]+):[^:]*:/u, `bencher:$1:${report.uuid}:`),
			output: {
				title: conclusion === "success" ? "Performance benchmarks passed" : "Performance alerts detected",
				summary: `[View the verified Bencher report](${url.href}).\n\nAlerts: ${report.alerts.length}.\n\nThe CLI left its check pending; finalized from the published report for the tested commit.`,
			},
		});
		if (updated.id !== check.id || updated.status !== "completed" || updated.conclusion !== conclusion) {
			throw new Error("GitHub did not acknowledge the expected completed Bencher check");
		}
		return { id: check.id, conclusion, repaired: true };
	} catch (error) {
		// Never guess success or edit a check from another invocation. A failed
		// publication stays a visible job failure, without silently retrying it.
		if (pending(check) && !mutationAttempted) {
			await io.updateCheck(check.id, {
				status: "completed",
				conclusion: "failure",
				output: {
					title: "Bencher report could not be verified",
					summary: "This invocation did not produce verifiable reporting evidence. See the Website Performance job logs.",
				},
			});
		}
		throw error;
	}
}

/** Platform adapter, kept separate so CLI arguments and API failures are tested. */
export function createBencherIO(context, options) {
	const { repository, command, args, exec = execFileSync, spawn = spawnSync,
		fetchReport = fetch, stdout = process.stdout, stderr = process.stderr } = options;
	const gh = (args, input) => JSON.parse(exec("gh", ["api", ...args], {
		encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input),
		maxBuffer: 16 * 1024 * 1024,
	}));
	return {
		listChecks: () => gh([
			`repos/${repository}/commits/${context.checkSha}/check-runs?filter=all&per_page=100`,
			"--paginate", "--slurp",
		]).flatMap((page) => page.check_runs),
		run: () => {
			const result = spawn(command, args, {
				encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
			});
			stdout.write(result.stdout ?? "");
			stderr.write(result.stderr ?? "");
			return result;
		},
		fetchReport: async (uuid) => {
			const response = await fetchReport(`https://api.bencher.dev/v0/projects/${encodeURIComponent(context.project)}/reports/${uuid}`, {
				redirect: "error", signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`Bencher report API returned HTTP ${response.status}`);
			return response.json();
		},
		updateCheck: (id, body) => gh([
			"--method", "PATCH", `repos/${repository}/check-runs/${id}`, "--input", "-",
		], body),
	};
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const context = {
		project: process.env.BENCHER_PROJECT,
		branch: process.env.BENCHER_BRANCH,
		testedSha: process.env.GITHUB_SHA,
		checkSha: event.pull_request?.head?.sha ?? process.env.GITHUB_SHA,
	};
	runBencherReport(context, createBencherIO(context, {
		repository: process.env.GITHUB_REPOSITORY,
		command: process.argv[2], args: process.argv.slice(3),
	})).then((result) => {
		console.log(`Bencher check ${result.id}: ${result.conclusion}${result.repaired ? " (finalized from verified report)" : ""}`);
	}).catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
