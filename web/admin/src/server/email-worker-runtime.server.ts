import "@tanstack/react-start/server-only";

const FAILURE = "Daily bulletin email worker stopped unexpectedly";
const SLOT = Symbol.for("tanah.daily-bulletin.email-worker.v1");

interface WorkerState {
	controller: AbortController;
	ready: Promise<void>;
	completion: Promise<void>;
	stopping: boolean;
	failure: Error | null;
	cleanup: () => void;
}
const globals = globalThis as typeof globalThis & { [SLOT]?: WorkerState };

function recordFailure(state: WorkerState): void {
	if (state.failure) return;
	state.failure = new Error(FAILURE);
	// Never include the provider error, credentials, recipient or event payload.
	console.error(FAILURE);
}

async function stop(state: WorkerState): Promise<void> {
	state.stopping = true;
	// Only the queue receive is cancelled. A claimed send finishes and persists its result.
	state.controller.abort();
	await state.ready;
	await state.completion;
	state.cleanup();
	if (state.failure) throw state.failure;
}

async function initialize(state: WorkerState): Promise<void> {
	const { loadEmailRuntime } = await import("./ses-settings.server");
	if (!loadEmailRuntime() || state.stopping) return;
	const [{ useNitroHooks }, { startEmailWorker }] = await Promise.all([
		import("nitro/app"),
		import("./ses-delivery.server"),
	]);
	if (state.stopping) return;
	const requestStop = () => {
		state.stopping = true;
		state.controller.abort();
	};
	// Nitro awaits close hooks on SIGTERM before completing server shutdown.
	// biome-ignore lint/correctness/useHookAtTopLevel: Nitro lifecycle API is not a React hook.
	const unhook = useNitroHooks().hook("close", () => stop(state));
	process.once("SIGTERM", requestStop);
	process.once("SIGINT", requestStop);
	state.cleanup = () => {
		unhook();
		process.removeListener("SIGTERM", requestStop);
		process.removeListener("SIGINT", requestStop);
	};
	state.completion = Promise.resolve()
		.then(() => startEmailWorker(state.controller.signal))
		.then(
			() => {
				if (!state.stopping) recordFailure(state);
			},
			() => {
				recordFailure(state);
			},
		)
		.finally(() => state.cleanup());
}

/** Request-time startup: importing/building the server never starts a worker. */
export async function ensureEmailWorkerStarted(): Promise<void> {
	if (
		process.env.BULLETIN_EMAIL_WORKER_ENABLED !== "true" ||
		(import.meta as ImportMeta & { prerender?: boolean }).prerender
	)
		return;
	// Check before loading settings: an unconfigured server must not import DB/AWS clients.
	if (
		![
			"BULLETIN_SES_FROM",
			"BULLETIN_SES_CONTACT_LIST",
			"BULLETIN_SES_CONFIGURATION_SET",
			"BULLETIN_EMAIL_QUEUE_URL",
			"BULLETIN_SES_ACCOUNT_ID",
		].every((name) => process.env[name]?.trim())
	)
		return;
	let state = globals[SLOT];
	if (!state) {
		state = {
			controller: new AbortController(),
			ready: Promise.resolve(),
			completion: Promise.resolve(),
			stopping: false,
			failure: null,
			cleanup: () => {},
		};
		globals[SLOT] = state;
		const created = state;
		state.ready = initialize(state).catch(() => {
			recordFailure(created);
			created.cleanup();
			throw created.failure;
		});
	}
	await state.ready;
	// Surface fatal failures to health requests, allowing the service to replace this process.
	if (state.failure) throw state.failure;
}

export async function stopEmailWorkerRuntime(): Promise<void> {
	const state = globals[SLOT];
	if (state) await stop(state);
}
