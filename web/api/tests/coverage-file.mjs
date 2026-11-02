import { statSync, watch } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

const COVERAGE_WAIT_TIMEOUT_MS = 30_000;

/** Wait without polling; a final stat also handles filesystems that drop watch events. */
export async function waitForCoverageFile(
	filePath,
	{
		notBeforeMs = Date.now(),
		timeoutMs = COVERAGE_WAIT_TIMEOUT_MS,
		watchDirectory = watch,
		readStats = stat,
		readFinalStats = statSync,
		now = Date.now,
		schedule = setTimeout,
		cancel = clearTimeout,
	} = {},
) {
	const directory = path.dirname(filePath);
	const filename = path.basename(filePath);
	await mkdir(directory, { recursive: true });
	const deadlineMs = now() + timeoutMs;

	await new Promise((resolve, reject) => {
		let watcher;
		let timeout;
		let settled = false;
		let checks = Promise.resolve();
		const finish = (error) => {
			if (settled) return;
			settled = true;
			cancel(timeout);
			try {
				watcher?.close();
			} catch (closeError) {
				error ??= closeError;
			}
			if (error) reject(error);
			else resolve();
		};
		const isReady = (stats) =>
			stats.isFile() &&
			stats.size > 0 &&
			stats.mtimeMs >= notBeforeMs &&
			stats.mtimeMs <= deadlineMs;
		const timeoutError = () =>
			new Error(`Timed out waiting for coverage report at ${filePath}`);
		const check = () => {
			checks = checks.then(async () => {
				if (settled) return;
				try {
					const stats = await readStats(filePath);
					if (isReady(stats)) {
						finish();
						return;
					}
				} catch (error) {
					if (error.code !== "ENOENT") {
						finish(error);
						return;
					}
				}
			});
		};

		try {
			// Callback watch registers now, before the first stat can miss a new file.
			watcher = watchDirectory(directory, (_event, changedName) => {
				if (changedName && changedName.toString() !== filename) return;
				check();
			});
			watcher.on("error", finish);
			timeout = schedule(
				() => {
					// Do not queue the deadline behind a stalled asynchronous stat.
					try {
						finish(
							isReady(readFinalStats(filePath)) ? undefined : timeoutError(),
						);
					} catch (error) {
						finish(error.code === "ENOENT" ? timeoutError() : error);
					}
				},
				Math.max(0, deadlineMs - now()),
			);
			check();
		} catch (error) {
			finish(error);
		}
	});
}
