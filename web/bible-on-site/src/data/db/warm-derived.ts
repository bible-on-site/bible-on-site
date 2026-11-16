import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import type { PasukIndexEntry, PerekIndexEntry } from "../../lib/search/corpus";

/**
 * Build-time derived warm-up data (issue #2997): the search indexes and the
 * recitation track metadata are deterministic functions of the bundled
 * canonical corpus, but computing them costs ~2.5 s of synchronous CPU on the
 * readiness critical path — several times more on the 0.5 vCPU task. The
 * prebuild writes this artifact beside the compressed corpus so a cold task
 * parses it instead of recomputing; sha256 over the corpus bytes proves the
 * artifact was derived from the exact corpus the image ships, and any miss or
 * mismatch falls back to the live computation unchanged.
 */

export interface WarmDerivedTrack {
	perekId: number;
	audioSha256: string;
	textSha256: string;
	durationMs: number;
	alignmentStatus: "pending" | "needs_review" | "ready";
	words: {
		pasuk: number;
		segment: number;
		text: string;
		startMs: number | null;
		endMs: number | null;
	}[];
}

export interface WarmDerived {
	corpusSha256: string;
	perakim: PerekIndexEntry[];
	pesukim: PasukIndexEntry[];
	/** Recitation tracks in canonical order minus `audioUrl` — URLs carry
	 * deploy-time storage settings, so consumers re-derive them per request. */
	recitations: WarmDerivedTrack[];
}

export const WARM_DERIVED_CORPUS_PATH =
	"src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json.br";
export const WARM_DERIVED_ARTIFACT_PATH =
	"src/data/db/warm-derived.generated.json.br";

export interface WarmDerivedOptions {
	env?: NodeJS.ProcessEnv;
	cwd?: string;
	read?: (path: string) => Buffer | string;
	decompress?: (data: Buffer | string) => Buffer | string;
	warn?: (...args: unknown[]) => void;
}

/** Returns the verified artifact, or null when live computation must run. */
export function loadWarmDerived({
	env = process.env,
	cwd = process.cwd(),
	read = readFileSync,
	decompress = brotliDecompressSync,
	warn = console.warn,
}: WarmDerivedOptions = {}): WarmDerived | null {
	// Production-only: dev loads the corpus from the raw JSON module, so an
	// artifact bound to the .br bytes could disagree with it there.
	if (
		env.IS_TEST_ENV ||
		env.WARM_DERIVED_DISABLE ||
		env.NODE_ENV !== "production"
	)
		return null;
	try {
		const corpusSha256 = createHash("sha256")
			.update(read(resolve(cwd, WARM_DERIVED_CORPUS_PATH)))
			.digest("hex");
		const artifact = JSON.parse(
			decompress(read(resolve(cwd, WARM_DERIVED_ARTIFACT_PATH))).toString(
				"utf8",
			),
		) as WarmDerived;
		if (
			artifact?.corpusSha256 === corpusSha256 &&
			Array.isArray(artifact.perakim) &&
			Array.isArray(artifact.pesukim) &&
			Array.isArray(artifact.recitations)
		)
			return artifact;
		warn(
			"Website warm-up artifact is stale relative to the corpus; computing live",
		);
	} catch (error) {
		// A missing artifact is the ordinary dev/test path; anything else is a
		// production anomaly worth surfacing in the container log.
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT")
			warn("Website warm-up artifact unreadable; computing live:", error);
	}
	return null;
}

const derivedKey = Symbol.for("bible-on-site.warm-derived");
const store = globalThis as typeof globalThis & {
	[derivedKey]?: WarmDerived | null;
};

/**
 * The derived data behind the readiness warm-up, shared across the
 * independently bundled route modules through `globalThis` like the corpus
 * itself. The miss result is cached too — artifact files never appear
 * mid-process, so re-reading them on every index call would only add IO.
 */
export function warmDerived(): WarmDerived | null {
	if (!Object.hasOwn(store, derivedKey)) store[derivedKey] = loadWarmDerived();
	return store[derivedKey] ?? null;
}
