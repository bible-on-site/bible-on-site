import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { APITaskProtection } from "./api-task-protection.mjs";
import {
	IMAGE_URI,
	LIMITS,
	ageUpperMs,
	assertService,
	assertTask,
	completed,
	discoveryMatches,
	fingerprint,
	healthy,
} from "./api-rollout-state.mjs";

function unchanged(state, baseline, definitions) {
	assertService(state.service);
	assert.ok(
		isDeepStrictEqual(
			fingerprint(state.service),
			fingerprint(baseline.service),
		),
		"API service settings changed during handover",
	);
	assert.ok(
		definitions.includes(state.service.taskDefinition),
		"Another deployment changed the API task definition",
	);
	assert.ok(state.active.length <= 2);
}
function freshRecoveryWindow(monitor, index, version, instance) {
	const rows = monitor.rows.slice(index);
	return (
		rows.length > 0 &&
		rows.every(
			(row) =>
				row.passed &&
				(!row.version ||
					(row.version === version && row.instance === instance)),
		)
	);
}

/** Recovery starts with a verified control-plane restore, even if public traffic
 * is currently unhealthy. All failed public samples remain in the journal.
 */
async function recover({
	aws,
	baseline,
	target,
	fallback,
	lease: sourceLease,
	replacement,
	monitor,
	now,
	wait,
	record,
}) {
	let lease = sourceLease,
		retiring = baseline.task,
		retiringVersion = baseline.public.version;
	// A completed rollout has already retired the original source. Protect the
	// exact replacement while restoring the old pin, so recovery also warms DNS.
	if (sourceLease.released && replacement) {
		const current = await aws.snapshot(baseline.task.taskArn);
		unchanged(current, baseline, [target.taskDefinitionArn]);
		const task = current.tasks.find(
			(row) => row.taskArn === replacement.taskArn,
		);
		if (task?.lastStatus === "RUNNING") {
			assertTask(task, target, replacement.image);
			retiring = task;
			retiringVersion = replacement.version;
			lease = new APITaskProtection({
				call: aws.call.bind(aws),
				task: task.taskArn,
				nonce: randomUUID(),
				record,
			});
			try {
				await lease.grant();
			} catch (error) {
				if (lease.confirmed) await lease.release();
				else if (lease.tagAttempted) await lease.removeUngrantedMarker();
				throw error;
			}
		}
	}
	try {
		const restore = await aws.rollback(baseline, target, fallback);
		record("recovery-started", {
			definition: restore.definition.taskDefinitionArn,
			image: restore.image,
			reusedSource: restore.reusedSource,
		});
		const started = now();
		let seen = null,
			completionAt = null,
			ecsCompleted = false,
			ready = false,
			visibility = null,
			exclusive = null;
		const candidateIndex = monitor.rows.length;
		let publicIndex = candidateIndex,
			candidateInstance = null;
		while (now() - started < LIMITS.overall) {
			const state = await aws.snapshot(retiring.taskArn);
			unchanged(state, baseline, [
				restore.definition.taskDefinitionArn,
				target.taskDefinitionArn,
			]);
			const old = state.tasks.find((task) => task.taskArn === retiring.taskArn);
			const candidates = state.tasks.filter(
				(task) =>
					task.taskDefinitionArn === restore.definition.taskDefinitionArn &&
					task.lastStatus === "RUNNING" &&
					[restore.image.root, restore.image.child].includes(
						task.containers[0].imageDigest,
					) &&
					(restore.reusedSource || task.taskArn !== retiring.taskArn),
			);
			assert.ok(candidates.length <= 1, "Ambiguous recovery task");
			if (candidates.length) {
				const task = candidates[0];
				assertTask(task, restore.definition, restore.image);
				if (seen === null) {
					seen = task.taskArn;
					completionAt = now();
				}
				assert.equal(task.taskArn, seen, "Recovery task was replaced");
				const recoveringOriginal = task.taskArn === baseline.task.taskArn;
				if (!ready && !recoveringOriginal) {
					assert.ok(
						ageUpperMs(task, state.clock) <= LIMITS.readiness,
						"Recovery readiness exceeded 30s",
					);
				}
				ready ||= healthy(task);
				candidateInstance = recoveringOriginal
					? baseline.public.instance
					: monitor.instance(
							baseline.public.version,
							baseline.public.instance,
							candidateIndex,
						);
				// A legacy fallback has no process header. Once its source has stopped,
				// the old version can only come from this verified replacement.
				const legacyFallback =
					!baseline.public.instance &&
					(retiringVersion !== baseline.public.version ||
						old?.lastStatus === "STOPPED") &&
					monitor.sawProcess(baseline.public.version, null, candidateIndex);
				const publicReady = recoveringOriginal
					? monitor.sawProcess(
							baseline.public.version,
							candidateInstance,
							candidateIndex,
						)
					: Boolean(candidateInstance || legacyFallback);
				if (
					lease.confirmed &&
					!lease.released &&
					task.taskArn !== retiring.taskArn
				) {
					await lease.assertActive();
					const visible =
						healthy(task) &&
						healthy(old) &&
						discoveryMatches(state.instances, [old, task]) &&
						publicReady;
					if (!visible) visibility = null;
					else if (visibility === null) visibility = now();
					else if (now() - visibility >= LIMITS.cache) await lease.release();
				}
				const singleton =
					completed(state.service) &&
					state.service.taskDefinition ===
						restore.definition.taskDefinitionArn &&
					healthy(task) &&
					discoveryMatches(state.instances, [task]) &&
					(task.taskArn === retiring.taskArn || old?.lastStatus === "STOPPED");
				if (
					monitor.rows
						.slice(publicIndex)
						.some(
							(row) =>
								!row.passed ||
								(row.version &&
									(row.version !== baseline.public.version ||
										row.instance !== candidateInstance)),
						)
				) {
					exclusive = null;
					publicIndex = monitor.rows.length;
				}
				if (
					singleton &&
					publicReady &&
					freshRecoveryWindow(
						monitor,
						publicIndex,
						baseline.public.version,
						candidateInstance,
					)
				) {
					if (exclusive === null) exclusive = now();
					else if (now() - exclusive >= LIMITS.cache) {
						assert.ok(
							monitor.sawProcess(
								baseline.public.version,
								candidateInstance,
								publicIndex,
							),
						);
						await monitor.contracts(
							baseline.public.version,
							baseline.contracts,
							candidateInstance,
						);
						assert.ok(
							now() - started < LIMITS.overall,
							"Recovery exceeded 300s during final verification",
						);
						if (lease.confirmed && !lease.released) await lease.release();
						record("recovery-completed", {
							task: seen,
							definition: restore.definition.taskDefinitionArn,
							image: restore.image,
							elapsedMs: now() - started,
							failedSamplesRetained: monitor.rows.filter((row) => !row.passed)
								.length,
						});
						return;
					}
				} else exclusive = null;
				if (completionAt !== null && !ecsCompleted) {
					assert.ok(
						now() - completionAt < LIMITS.completion,
						"Recovery ECS completion exceeded 180s",
					);
					ecsCompleted = completed(state.service);
				}
			}
			await wait(LIMITS.poll);
		}
		throw new Error(
			"Recovery exceeded 300s; inspect the journal and retain uncertain protection until its recorded expiration",
		);
	} catch (error) {
		record("recovery-owned-lease", {
			task: retiring.taskArn,
			key: lease.key,
			expiration: lease.expiration,
			confirmed: lease.confirmed,
			released: lease.released,
		});
		throw error;
	}
}

/** Sole API publication/rollout owner. The publisher remains responsible for
 * archive/source/index admission; this coordinator owns runtime handover.
 */
export async function runAPIRollout({
	aws,
	monitor,
	publish,
	version,
	architecture = null,
	imageMode = "latest",
	nonce = randomUUID(),
	now = () => performance.now(),
	wait = sleep,
	record = () => {},
}) {
	assert.match(version, /^\d+\.\d+\.\d+$/);
	assert.ok(["latest", "pinned"].includes(imageMode));
	const initial = await aws.preflight(),
		task = initial.tasks[0];
	const currentArchitecture =
		initial.definition.runtimePlatform?.cpuArchitecture ?? "X86_64";
	architecture ??= currentArchitecture;
	assert.ok(["X86_64", "ARM64"].includes(architecture));
	const oldImage = await aws.image(
		task.containers[0].imageDigest,
		currentArchitecture,
		true,
	);
	assertTask(task, initial.definition, oldImage);
	assert.ok(healthy(task), "The existing API task must be healthy");
	assert.ok(
		discoveryMatches(initial.instances, [task]),
		"The existing API task must be the only healthy discovery instance",
	);
	const baseline = {
		...initial,
		task,
		image: oldImage,
		public: await monitor.baseline(),
	};
	baseline.contracts = await monitor.contracts(baseline.public.version);
	const fallbackImage = IMAGE_URI + "@" + oldImage.child;
	const fallback =
		initial.definition.containerDefinitions[0].image === fallbackImage
			? initial.definition
			: await aws.register(
					initial.definition,
					initial.tags,
					currentArchitecture,
					fallbackImage,
				);
	record("rollback-prepared", {
		definition: fallback.taskDefinitionArn,
		image: oldImage,
		sourceTask: task.taskArn,
	});
	const lease = new APITaskProtection({
		call: aws.call.bind(aws),
		task: task.taskArn,
		nonce,
		record,
	});
	let attempted = false,
		target = null,
		replacement = null;
	monitor.start();
	try {
		await lease.grant();
		monitor.assertHealthy();
		await publish();
		monitor.assertHealthy();
		const image = await aws.published(version, architecture);
		const uri =
			imageMode === "pinned"
				? IMAGE_URI + "@" + image.child
				: IMAGE_URI + ":latest";
		target =
			currentArchitecture === architecture &&
			initial.definition.containerDefinitions[0].image === uri
				? initial.definition
				: await aws.register(
						initial.definition,
						initial.tags,
						architecture,
						uri,
					);
		if (
			image.child === oldImage.child &&
			target.taskDefinitionArn === initial.definition.taskDefinitionArn &&
			baseline.public.version === version
		) {
			await lease.release();
			monitor.assertHealthy();
			record("rollout-already-current", { version, image, task: task.taskArn });
			return { version, image, task: task.taskArn, changed: false };
		}
		await lease.assertActive(LIMITS.overall / 1000);
		monitor.assertHealthy();
		// Set before the RPC: a lost UpdateService acknowledgement still needs recovery.
		attempted = true;
		const started = now();
		await aws.update(target, baseline.service);
		let candidate = null,
			candidateInstance = null,
			observedAt = null,
			ready = false;
		let visibleSince = null,
			exclusiveSince = null,
			exclusiveIndex = null,
			ecsCompleted = false;
		while (now() - started < LIMITS.overall) {
			monitor.assertHealthy();
			const state = await aws.snapshot(task.taskArn);
			unchanged(state, baseline, [target.taskDefinitionArn]);
			assert.ok(
				!state.service.deployments.some(
					(row) => row.rolloutState === "FAILED" || row.failedTasks > 0,
				),
				"ECS reported a failed API deployment",
			);
			const old = state.tasks.find((row) => row.taskArn === task.taskArn);
			const replacements = state.tasks.filter(
				(row) =>
					row.taskArn !== task.taskArn &&
					row.lastStatus === "RUNNING" &&
					row.startedAt,
			);
			assert.ok(replacements.length <= 1);
			if (replacements.length) {
				const next = replacements[0];
				assertTask(next, target, image);
				if (candidate === null) {
					candidate = next.taskArn;
					observedAt = now();
				}
				replacement = { taskArn: candidate, image, version };
				assert.equal(
					next.taskArn,
					candidate,
					"The replacement API task changed",
				);
				assert.notEqual(next.healthStatus, "UNHEALTHY");
				if (!ready) {
					const age = ageUpperMs(next, state.clock);
					assert.ok(age <= LIMITS.readiness, "New API readiness exceeded 30s");
					if (healthy(next)) {
						ready = true;
						record("replacement-ready", {
							task: candidate,
							upperMs: age,
							image,
						});
					}
				}
				candidateInstance ??= monitor.instance(
					version,
					baseline.public.instance,
					0,
					false,
				);
				if (!lease.released) {
					await lease.assertActive();
					assert.ok(healthy(old), "Protected source API task became unhealthy");
					const visible =
						healthy(next) &&
						discoveryMatches(state.instances, [old, next]) &&
						candidateInstance !== null;
					if (!visible) visibleSince = null;
					else if (visibleSince === null) visibleSince = now();
					else if (
						now() - visibleSince >= LIMITS.cache &&
						monitor.sawProcess(version, candidateInstance)
					) {
						monitor.assertHealthy();
						record("replacement-visible", {
							task: candidate,
							instance: candidateInstance,
							existingDNSTTL: 10,
							existingRouterCache: 10,
							observedMs: now() - visibleSince,
						});
						await lease.release();
					}
				}
				if (!ecsCompleted) {
					assert.ok(
						now() - observedAt < LIMITS.completion,
						"API ECS completion exceeded 180s",
					);
					ecsCompleted = completed(state.service);
				}
				const exclusive =
					lease.released &&
					completed(state.service) &&
					healthy(next) &&
					old?.lastStatus === "STOPPED" &&
					discoveryMatches(state.instances, [next]);
				if (exclusive) {
					if (exclusiveSince === null) {
						exclusiveSince = now();
						exclusiveIndex = monitor.rows.length;
					}
					if (
						!freshRecoveryWindow(
							monitor,
							exclusiveIndex,
							version,
							candidateInstance,
						) &&
						monitor.rows.length > exclusiveIndex
					) {
						exclusiveSince = now();
						exclusiveIndex = monitor.rows.length;
					}
					if (
						now() - exclusiveSince >= LIMITS.cache &&
						monitor.instance(
							version,
							baseline.public.instance,
							exclusiveIndex,
						) === candidateInstance
					) {
						await monitor.contracts(
							version,
							baseline.contracts,
							candidateInstance,
						);
						monitor.assertHealthy();
						assert.ok(
							now() - started < LIMITS.overall,
							"API handover exceeded 300s during final verification",
						);
						const result = {
							changed: true,
							version,
							image,
							task: candidate,
							instance: candidateInstance,
							definition: target.taskDefinitionArn,
							rollbackDefinition: fallback.taskDefinitionArn,
							elapsedMs: now() - started,
							publicSamples: monitor.rows.length,
							protectionReleased: lease.released,
						};
						record("rollout-completed", result);
						return result;
					}
				} else {
					exclusiveSince = null;
					exclusiveIndex = null;
				}
			}
			await wait(LIMITS.poll);
		}
		throw new Error("API handover exceeded 300s");
	} catch (error) {
		record("rollout-failed", {
			name: error.name,
			code: error.code ?? null,
			location:
				error.stack
					?.split("\n")
					.find((line) => /^\s+at /.test(line))
					?.trim() ?? null,
			attempted,
			protectedTask: lease.confirmed && !lease.released ? task.taskArn : null,
			leaseKey: lease.key,
			expiration: lease.expiration,
		});
		if (attempted) {
			try {
				await recover({
					aws,
					baseline,
					target,
					fallback,
					lease,
					replacement,
					monitor,
					now,
					wait,
					record,
				});
			} catch (recoveryError) {
				record("recovery-failed", {
					name: recoveryError.name,
					code: recoveryError.code ?? null,
					protectedTask: task.taskArn,
					leaseKey: lease.key,
					expiration: lease.expiration,
				});
				throw new Error(
					"API rollout and recovery failed; inspect recorded task/lease ownership before further changes",
				);
			}
		} else if (lease.confirmed && !lease.released) await lease.release();
		else if (lease.tagAttempted) await lease.removeUngrantedMarker();
		throw error;
	} finally {
		await monitor.stop();
	}
}
