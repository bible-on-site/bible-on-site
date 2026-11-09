import { MainThreadTasks } from "lighthouse/core/computed/main-thread-tasks.js";
import { NetworkRecords } from "lighthouse/core/computed/network-records.js";
import {
	getAttributableURLForTask,
	getJavaScriptURLs,
} from "lighthouse/core/lib/tracehouse/task-summary.js";

// Same selection as Lighthouse's main-thread-tasks audit: sizable top-level
// tasks only (duration over 5ms, no parent task).
const MIN_TOP_LEVEL_TASK_MS = 5;

/**
 * @param {Array<import("lighthouse/core/lib/tracehouse/main-thread-tasks.js").TaskNode>} tasks
 * @returns {import("lighthouse/core/lib/tracehouse/main-thread-tasks.js").TaskNode | null}
 */
export function largestTopLevelTask(tasks) {
	/** @type {import("lighthouse/core/lib/tracehouse/main-thread-tasks.js").TaskNode | null} */
	let largest = null;
	for (const task of tasks) {
		if (task.parent || task.duration <= MIN_TOP_LEVEL_TASK_MS) continue;
		if (!largest || task.duration > largest.duration) largest = task;
	}
	return largest;
}

/**
 * Observed (pre-simulation) record of the largest top-level main-thread task:
 * start time, duration and the URL Lighthouse attributes the task to. Under
 * throttlingMethod "simulate" the LHR's long-tasks/TBT values are Lantern
 * models, so this is an independent observed-task signal — ranking observed
 * durations does not prove this task produced a modeled long task. On a
 * modeled-TBT recurrence the retained *.artifacts.json trace resolves the
 * exact modeled/observed mapping, including runs where modeled TBT stays 0.
 *
 * @param {import("lighthouse").RunnerResult["artifacts"]} artifacts
 * @returns {Promise<{startTime: number, duration: number, attributableUrl: string} | null>}
 */
export async function largestObservedTopLevelTask(artifacts) {
	const context = { computedCache: new Map() };
	const tasks = await MainThreadTasks.request(artifacts.Trace, context);
	const networkRecords = await NetworkRecords.request(
		artifacts.DevtoolsLog,
		context,
	);
	const jsUrls = getJavaScriptURLs(networkRecords);
	const task = largestTopLevelTask(tasks);
	if (!task) return null;
	return {
		startTime: task.startTime,
		duration: task.duration,
		attributableUrl: getAttributableURLForTask(task, jsUrls),
	};
}
