/**
 * Store metadata for README badges and machine-readable lookups
 * (#2371, resilience rework #2395).
 *
 * The pipeline feeds Shields dynamic-JSON badges. Shields gives the upstream
 * fetch 3.5 s before rendering "inaccessible", renders an absent JSONPath as
 * "no result" and a null one as a bare suffix ("/5"), and caches each badge
 * for ~2 min. So this module is built around serving a retained last-good
 * answer fast instead of scraping a store on the request path:
 *
 * - Each observed field (version, rating, ratingCount, sourceUpdatedAt) is
 *   kept separately with the time it was observed. A store answer merges
 *   into those observations field by field — an incomplete parse never
 *   evicts a still-valid last-good value, and never pretends to be a fresh
 *   observation of a field it did not carry.
 * - Responses are assembled from observations younger than 24 h. `stale` is
 *   true when any served field is older than the 1 h fresh window or when
 *   nothing was ever observed — a partial answer is never stamped fresh.
 *   `attemptedAt` still exposes failed re-verification for diagnostics.
 * - Refresh work is deduplicated per platform (one in-flight fetch) and
 *   bounded: nextRefreshAt is +1 h after an answer that carried fields and
 *   +60 s doubling to 15 min after failures, so a store that stops
 *   publishing a field cannot trigger a fetch per request.
 * - With nothing usable to serve, the caller waits only up to
 *   RESPONSE_DEADLINE_MS — inside Shields' 3.5 s upstream timeout — so a slow
 *   scrape yields a degraded answer instead of "inaccessible".
 * - A build-time snapshot (src/data/db/store-metadata-snapshot.generated.json,
 *   written by scripts/collect-store-metadata.mts during `next build`) seeds
 *   the last-good store so a cold process already has real observations.
 *
 * Honesty: fields are omitted downstream when never observed or expired,
 * fetchedAt is the last time the source actually answered with data, and
 * attemptedAt exposes the most recent refresh attempt for debugging.
 */

import snapshot from "@/data/db/store-metadata-snapshot.generated.json";
import {
	type CollectedStoreMetadata,
	collectStoreMetadata,
	STORE_METADATA_SOURCES,
	type StorePlatform,
} from "./collect";

export interface StoreMetadata {
	platform: StorePlatform;
	version: string | null;
	/** Star rating on ratingScale; null when the store does not publish it. */
	rating: number | null;
	ratingScale: 5;
	ratingCount: number | null;
	source: string;
	/** ISO time the upstream source last answered with any observed field. */
	fetchedAt: string | null;
	/** ISO time of the most recent refresh attempt, successful or not. */
	attemptedAt: string | null;
	/** ISO time the source catalog reports its data last modified (windows). */
	sourceUpdatedAt: string | null;
	/**
	 * True when any served field is past its fresh window or the source never
	 * answered — a partial answer is never reported as fresh.
	 */
	stale: boolean;
}

/** After an answer, the next refresh is due once the fresh window passes. */
const FRESH_MS = 60 * 60 * 1000;
/** A last-good field observation is served for at most this long. */
const LAST_GOOD_MS = 24 * 60 * 60 * 1000;
/**
 * How long a request with nothing usable waits for a refresh before
 * answering degraded. Must stay below the 3.5 s Shields upstream timeout so
 * badge fetches get JSON instead of an "inaccessible" timeout.
 */
const RESPONSE_DEADLINE_MS = 3_000;
const RETRY_BACKOFF_BASE_MS = 60_000;
const RETRY_BACKOFF_MAX_MS = 15 * 60 * 1000;

interface FieldObservation<T> {
	value: T;
	observedAt: number;
}

interface PlatformState {
	version?: FieldObservation<string>;
	rating?: FieldObservation<number>;
	ratingCount?: FieldObservation<number>;
	sourceUpdatedAt?: FieldObservation<string>;
	/** Last time the source answered with at least one usable field. */
	lastAnswerAt: number | null;
	/** Last refresh attempt time (success or failure). */
	lastAttemptAt: number | null;
	consecutiveFailures: number;
	/** No new upstream attempt before this time (cadence or backoff). */
	nextRefreshAt: number;
}

const states = new Map<StorePlatform, PlatformState>();
const inFlight = new Map<StorePlatform, Promise<void>>();

function emptyState(): PlatformState {
	return {
		lastAnswerAt: null,
		lastAttemptAt: null,
		consecutiveFailures: 0,
		nextRefreshAt: 0,
	};
}

function getState(platform: StorePlatform): PlatformState {
	let state = states.get(platform);
	if (!state) {
		state = emptyState();
		states.set(platform, state);
	}
	return state;
}

/** Seed the last-good store from the build-time snapshot, if present. */
function hydrateFromSnapshot(): void {
	const entries = snapshot as unknown as Partial<
		Record<StorePlatform, CollectedStoreMetadata | undefined>
	>;
	for (const platform of Object.keys(
		STORE_METADATA_SOURCES,
	) as StorePlatform[]) {
		const collected = entries[platform];
		const observedAt = Date.parse(collected?.fetchedAt ?? "");
		if (!collected || !Number.isFinite(observedAt)) continue;
		const state = getState(platform);
		if (collected.version !== null)
			state.version = { value: collected.version, observedAt };
		if (collected.rating !== null)
			state.rating = { value: collected.rating, observedAt };
		if (collected.ratingCount !== null)
			state.ratingCount = { value: collected.ratingCount, observedAt };
		if (collected.sourceUpdatedAt !== null)
			state.sourceUpdatedAt = {
				value: collected.sourceUpdatedAt,
				observedAt,
			};
		if (
			state.version ||
			state.rating ||
			state.ratingCount ||
			state.sourceUpdatedAt
		)
			state.lastAnswerAt = observedAt;
	}
}

hydrateFromSnapshot();

function servedObservation<T>(
	observation: FieldObservation<T> | undefined,
	now: number,
): T | null {
	return observation && now - observation.observedAt < LAST_GOOD_MS
		? observation.value
		: null;
}

function assemble(
	platform: StorePlatform,
	state: PlatformState,
	now: number,
): StoreMetadata {
	const observations = [
		state.version,
		state.rating,
		state.ratingCount,
		state.sourceUpdatedAt,
	].filter(
		(observation): observation is NonNullable<typeof observation> =>
			observation !== undefined &&
			now - observation.observedAt < LAST_GOOD_MS,
	);
	const fresh =
		observations.length > 0 &&
		observations.every(
			(observation) => now - observation.observedAt < FRESH_MS,
		);
	return {
		platform,
		version: servedObservation(state.version, now),
		rating: servedObservation(state.rating, now),
		ratingScale: 5,
		ratingCount: servedObservation(state.ratingCount, now),
		source: STORE_METADATA_SOURCES[platform],
		fetchedAt: state.lastAnswerAt
			? new Date(state.lastAnswerAt).toISOString()
			: null,
		attemptedAt: state.lastAttemptAt
			? new Date(state.lastAttemptAt).toISOString()
			: null,
		sourceUpdatedAt: servedObservation(state.sourceUpdatedAt, now),
		stale: !fresh,
	};
}

function hasServedData(metadata: StoreMetadata): boolean {
	return (
		metadata.version !== null ||
		metadata.rating !== null ||
		metadata.ratingCount !== null ||
		metadata.sourceUpdatedAt !== null
	);
}

function noteFailure(state: PlatformState, attemptAt: number): void {
	state.consecutiveFailures += 1;
	state.nextRefreshAt =
		attemptAt +
		Math.min(
			RETRY_BACKOFF_BASE_MS * 2 ** (state.consecutiveFailures - 1),
			RETRY_BACKOFF_MAX_MS,
		);
}

function noteAnswer(
	state: PlatformState,
	collected: CollectedStoreMetadata,
	attemptAt: number,
): void {
	let observed = false;
	if (collected.version !== null) {
		state.version = { value: collected.version, observedAt: attemptAt };
		observed = true;
	}
	if (collected.rating !== null) {
		state.rating = { value: collected.rating, observedAt: attemptAt };
		observed = true;
	}
	if (collected.ratingCount !== null) {
		state.ratingCount = { value: collected.ratingCount, observedAt: attemptAt };
		observed = true;
	}
	if (collected.sourceUpdatedAt !== null) {
		state.sourceUpdatedAt = {
			value: collected.sourceUpdatedAt,
			observedAt: attemptAt,
		};
		observed = true;
	}
	if (observed) {
		state.lastAnswerAt = attemptAt;
		state.consecutiveFailures = 0;
		state.nextRefreshAt = attemptAt + FRESH_MS;
	} else {
		// An HTTP answer carrying zero usable fields is a failed observation:
		// it must not overwrite last-good and must back off like an error.
		console.warn(
			`store-metadata ${collected.platform}: answer carried no usable fields`,
		);
		noteFailure(state, attemptAt);
	}
}

/**
 * Start (or join) a deduplicated background refresh. Always resolves; the
 * failure path records the backoff instead of rejecting so fire-and-forget
 * callers never see an unhandled rejection.
 */
function requestRefresh(platform: StorePlatform): Promise<void> {
	const pending = inFlight.get(platform);
	if (pending) return pending;
	const state = getState(platform);
	if (Date.now() < state.nextRefreshAt) return Promise.resolve();
	const task = (async () => {
		const attemptAt = Date.now();
		state.lastAttemptAt = attemptAt;
		try {
			const collected = await collectStoreMetadata(platform);
			noteAnswer(state, collected, attemptAt);
		} catch (error) {
			console.warn(`store-metadata ${platform}: upstream failed`, error);
			noteFailure(state, attemptAt);
		}
	})().finally(() => {
		inFlight.delete(platform);
	});
	inFlight.set(platform, task);
	return task;
}

export async function getStoreMetadata(
	platform: StorePlatform,
): Promise<StoreMetadata> {
	const now = Date.now();
	const state = getState(platform);
	const record = assemble(platform, state, now);
	if (!record.stale) return record;
	const refresh = requestRefresh(platform);
	if (hasServedData(record)) {
		// Stale-while-revalidate: answer from last-good immediately.
		void refresh;
		return record;
	}
	// Nothing usable yet (cold start, all observations expired): give the
	// refresh a bounded window so badges get data instead of a timeout.
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, RESPONSE_DEADLINE_MS);
	});
	await Promise.race([refresh, deadline]);
	clearTimeout(timer);
	return assemble(platform, state, Date.now());
}

export {
	collectStoreMetadata,
	parseItunesLookup,
	parsePlayStoreHtml,
	parseWindowsCatalog,
} from "./collect";
