import assert from "node:assert/strict";
import { test } from "node:test";

import {
	ENTRIES_DIR,
	ENTRY_TEXT_LIMIT,
	MAINTENANCE_TEXT,
	TARGETS,
	compareVersions,
	entriesAt,
	generate,
	renderNotes,
	resolveBaselineVersion,
	selectFeatures,
	validateEntry,
} from "./store-release-notes.mjs";

const repo = "test/repo";
const DIR = "app/store-release-notes";
const he = (suffix) => `אפשר ללמוד פרק חדש בקלות ${suffix}.`;

const entry = (over = {}) => ({
	text: he("של גרסה זו"),
	platforms: ["android", "ios", "windows"],
	...over,
});

// --- validateEntry ---

test("validateEntry normalizes a valid entry", () => {
	const result = validateEntry(
		"new-reader.json",
		entry({ kind: "fix", enabled: false, pr: 42 }),
	);
	assert.deepEqual(result, {
		text: he("של גרסה זו"),
		platforms: ["android", "ios", "windows"],
		kind: "fix",
		enabled: false,
		pr: 42,
	});
});

test("validateEntry defaults kind to feature and enabled to true", () => {
	const result = validateEntry("a.json", entry());
	assert.equal(result.kind, "feature");
	assert.equal(result.enabled, true);
	assert.equal(result.pr, undefined);
});

test("validateEntry rejects Latin, links and technical content", () => {
	for (const [bad, field] of [
		[entry({ text: "New feature בעברית" }), "Latin"],
		[entry({ text: "ראו https://example.com לפרטים" }), "URL"],
		[entry({ text: "feat: משהו חדש" }), "developer prefix"],
		[entry({ text: "תיקון מספר #1234" }), "issue number"],
		[entry({ text: "גרסה־חדשה של התנך" }), "maqaf"],
		[entry({ text: 'לימוד תנ״ך יומי' }), "gershayim"],
		[entry({ text: "שיפור — גדול" }), "typographic dash"],
		[entry({ text: "1234 !!!" }), "no Hebrew"],
	]) {
		assert.throws(() => validateEntry("a.json", bad), /Invalid store-notes entry/, field);
	}
	assert.throws(
		() => validateEntry("a.json", entry({ platforms: [] })),
		/platforms/,
	);
	assert.throws(
		() => validateEntry("a.json", entry({ platforms: ["webos"] })),
		/platforms/,
	);
	assert.throws(
		() =>
			validateEntry(
				"a.json",
				entry({ platforms: ["android", "android"] }),
			),
		/platforms/,
	);
	assert.throws(
		() => validateEntry("a.json", entry({ kind: "docs" })),
		/kind/,
	);
	assert.throws(
		() => validateEntry("a.json", entry({ enabled: "yes" })),
		/enabled/,
	);
	assert.throws(
		() => validateEntry("a.json", entry({ text: "א".repeat(ENTRY_TEXT_LIMIT + 1) })),
		/limit/,
	);
	assert.throws(
		() => validateEntry("a.json", entry({ unknown: 1 })),
		/unknown field/,
	);
});

// --- compareVersions ---

test("compareVersions orders semantic versions", () => {
	assert.ok(compareVersions("5.1.7", "5.1.8") < 0);
	assert.ok(compareVersions("5.10.0", "5.1.99") > 0);
	assert.equal(compareVersions("5.1.7", "5.1.7"), 0);
});

// --- resolveBaselineVersion ---

const deployment = (version, id, env = "app-android") => ({
	id,
	payload: { release_key: `${env}-v${version}` },
});

const baselineApi = (deployments, statuses = {}) => (endpoint) => {
	if (endpoint.includes("/statuses")) {
		const id = endpoint.match(/deployments\/(\d+)\/statuses/)[1];
		return [statuses[id] ?? { state: "failure" }];
	}
	const page = endpoint.match(/[?&]page=(\d+)/)?.[1];
	if (page !== undefined) return page === "1" ? deployments : [];
	throw new Error(`unexpected api call ${endpoint}`);
};

test("resolveBaselineVersion picks the newest delivered version below the target", () => {
	const deployments = [
		deployment("5.1.8", 4),
		deployment("5.1.7", 3),
		deployment("5.1.6", 2),
		deployment("5.1.5", 1),
	];
	const api = baselineApi(deployments, { 3: { state: "success" }, 2: { state: "success" }, 4: { state: "success" } });
	assert.equal(
		resolveBaselineVersion({
			repo,
			environment: "app-android",
			version: "5.1.8",
			api,
		}),
		"5.1.7",
	);
});

test("resolveBaselineVersion skips failed and in-progress deliveries", () => {
	const deployments = [deployment("5.1.6", 3), deployment("5.1.5", 2), deployment("5.1.4", 1)];
	// 5.1.6 failed after binary upload (#2970): it never became a baseline.
	const api = baselineApi(deployments, { 3: { state: "failure" }, 2: { state: "in_progress" }, 1: { state: "success" } });
	assert.equal(
		resolveBaselineVersion({ repo, environment: "app-android", version: "5.1.7", api }),
		"5.1.4",
	);
});

test("resolveBaselineVersion succeeds on a retried deployment and returns null for a first release", () => {
	const deployments = [deployment("5.1.6", 3), deployment("5.1.6", 2)];
	const api = baselineApi(deployments, { 2: { state: "failure" }, 3: { state: "success" } });
	assert.equal(
		resolveBaselineVersion({ repo, environment: "app-android", version: "5.1.7", api }),
		"5.1.6",
	);
	assert.equal(
		resolveBaselineVersion({ repo, environment: "app-android", version: "5.1.7", api: baselineApi([]) }),
		null,
	);
});

// --- entriesAt / selectFeatures ---

/**
 * Fake git transport over a fixture: `trees[ref][file] = json`.
 * `trees[ref] === undefined` means the entries dir does not exist at ref.
 */
const fixtureGit = (trees) => (args) => {
	if (args[0] === "ls-tree" && args.includes("-r")) {
		const files = trees[args[3]];
		if (!files) return "";
		return Object.keys(files)
			.map((f) => `${DIR}/${f}`)
			.join("\n");
	}
	if (args[0] === "ls-tree")
		return trees[args[1]] ? `040000 tree x\t${DIR}` : "";
	if (args[0] === "show") {
		const [fileRef, file] = args[1].split(":");
		const content = trees[fileRef]?.[file.split("/").pop()];
		if (content === undefined) throw new Error(`missing ${args[1]}`);
		return JSON.stringify(content);
	}
	throw new Error(`unexpected git call ${args.join(" ")}`);
};

test("entriesAt validates entry files and ignores non-json files", () => {
	const git = fixtureGit({
		"app-v5.1.8": {
			"new-reader.json": entry(),
			"README.md": "# docs",
		},
	});
	const entries = entriesAt("app-v5.1.8", DIR, git);
	assert.equal(entries.size, 1);
	assert.equal(entries.get("new-reader.json").kind, "feature");
	assert.equal(entriesAt("app-v5.0.0", DIR, git), null);
});

test("selectFeatures announces entries absent or disabled at baseline", () => {
	const git = fixtureGit({
		"app-v5.1.7": {
			"shipped.json": entry({ text: he("קודם") }),
			"pending.json": entry({ enabled: false }),
		},
		"app-v5.1.8": {
			"shipped.json": entry({ text: he("קודם") }),
			"pending.json": entry(),
			"brand-new.json": entry({ kind: "fix" }),
			"disabled.json": entry({ enabled: false }),
		},
	});
	const features = selectFeatures({
		baselineTag: "app-v5.1.7",
		tag: "app-v5.1.8",
		dir: DIR,
		platform: "android",
		git,
	});
	assert.deepEqual(
		features.map((f) => f.id).sort(),
		["brand-new.json", "pending.json"],
	);
});

test("selectFeatures announces a platform expansion to the new audience only", () => {
	const git = fixtureGit({
		// 5.1.7 shipped the reader on Android only; 5.1.8 adds iOS.
		"app-v5.1.7": {
			"reader.json": entry({ platforms: ["android"] }),
		},
		"app-v5.1.8": {
			"reader.json": entry({ platforms: ["android", "ios"] }),
		},
	});
	// iOS users were never told — the entry is new to their audience.
	assert.deepEqual(
		selectFeatures({
			baselineTag: "app-v5.1.7",
			tag: "app-v5.1.8",
			dir: DIR,
			platform: "ios",
			git,
		}).map((f) => f.id),
		["reader.json"],
	);
	// Android already heard about it — no repeat announcement.
	assert.deepEqual(
		selectFeatures({
			baselineTag: "app-v5.1.7",
			tag: "app-v5.1.8",
			dir: DIR,
			platform: "android",
			git,
		}),
		[],
	);
});

test("selectFeatures covers skipped intermediate versions and reverted work", () => {
	const git = fixtureGit({
		// Baseline 5.1.4: none of these existed.
		"app-v5.1.4": { "old.json": entry() },
		// 5.1.8 ships entries first added in skipped 5.1.5/5.1.6 plus one
		// added-then-reverted entry that is gone at the tag.
		"app-v5.1.8": {
			"old.json": entry(),
			"from-5-1-5.json": entry(),
			"from-5-1-6.json": entry({ kind: "performance" }),
		},
	});
	const features = selectFeatures({
		baselineTag: "app-v5.1.4",
		tag: "app-v5.1.8",
		dir: DIR,
		platform: "android",
		git,
	});
	assert.deepEqual(
		features.map((f) => f.id).sort(),
		["from-5-1-5.json", "from-5-1-6.json"],
	);
	// No baseline at all (first release): everything enabled is new.
	assert.equal(
		selectFeatures({ baselineTag: null, tag: "app-v5.1.8", dir: DIR, platform: "android", git }).length,
		3,
	);
});

// --- renderNotes ---

const feature = (id, over = {}) => ({ id, kind: "feature", ...entry(over) });

test("renderNotes orders features then fixes then performance, platform-filtered", () => {
	const { notes, used } = renderNotes({
		platform: "android",
		limit: 4000,
		features: [
			feature("b-perf.json", { kind: "performance" }),
			feature("a-fix.json", { kind: "fix" }),
			feature("c-feat.json", {}),
			feature("d-ios.json", { platforms: ["ios"] }),
		],
	});
	assert.deepEqual(used, ["c-feat.json", "a-fix.json", "b-perf.json"]);
	assert.ok(notes.startsWith("• "));
	assert.equal(notes.split("\n").length, 3);
	assert.ok(!notes.includes("d-ios"));
});

test("renderNotes drops whole bullets past the limit, never mid-sentence", () => {
	const long = feature("long.json", { text: `${"ב".repeat(199)}.` });
	const short = feature("short.json", { text: he("קצרה") });
	const other = feature("other.json", { text: he("אחרת") });
	const fitsLongAndOther =
		(`• ${long.text}`.length + 1 + `• ${other.text}`.length);
	const { notes, used, dropped } = renderNotes({
		platform: "ios",
		limit: fitsLongAndOther,
		features: [long, other, short],
	});
	assert.equal(notes.split("\n").length, 2);
	assert.ok(notes.length <= fitsLongAndOther);
	for (const line of notes.split("\n"))
		assert.ok(line.startsWith("• ") && line.endsWith("."));
	assert.deepEqual(used, ["long.json", "other.json"]);
	assert.deepEqual(dropped, ["short.json"]);
});

test("renderNotes falls back to honest maintenance copy when nothing applies", () => {
	for (const features of [[], [feature("ios.json", { platforms: ["ios"] })]]) {
		const { notes, used } = renderNotes({
			features,
			platform: "android",
			limit: 500,
		});
		assert.equal(notes, MAINTENANCE_TEXT);
		assert.deepEqual(used, []);
	}
	// A single bullet that cannot fit anywhere also degrades honestly.
	const { notes } = renderNotes({
		features: [feature("huge.json", { text: "ב".repeat(200) })],
		platform: "android",
		limit: 50,
	});
	assert.equal(notes, MAINTENANCE_TEXT);
});

// --- generate ---

test("generate composes baseline, selection and rendering into a manifest", () => {
	const deployments = [deployment("5.1.7", 9), deployment("5.1.6", 8)];
	const api = baselineApi(deployments, { 9: { state: "success" }, 8: { state: "success" } });
	const git = fixtureGit({
		"app-v5.1.7": {},
		"app-v5.1.8": {
			"android-only.json": entry({ platforms: ["android"] }),
			"ios-only.json": entry({ platforms: ["ios"] }),
		},
	});
	const manifest = generate({
		repo,
		target: "app-android",
		version: "5.1.8",
		tag: "app-v5.1.8",
		git,
		api,
	});
	assert.equal(manifest.baselineVersion, "5.1.7");
	assert.equal(manifest.baselineTag, "app-v5.1.7");
	assert.equal(manifest.entriesSupported, true);
	// ios-only entry is not selected for the android audience at all.
	assert.deepEqual(
		manifest.features.map((f) => f.id).sort(),
		["android-only.json"],
	);
	assert.deepEqual(manifest.rendered, ["android-only.json"]);
	assert.ok(manifest.notes.includes("• "));
	assert.ok(/^[0-9a-f]{64}$/.test(manifest.digest));

	// Same inputs → identical digest (reproducible reruns).
	const again = generate({
		repo, target: "app-android", version: "5.1.8", tag: "app-v5.1.8", git, api,
	});
	assert.equal(again.digest, manifest.digest);
});

test("generate reports notes:null for releases predating curated entries", () => {
	const api = baselineApi([], {});
	const git = fixtureGit({ "app-v1.0.0": undefined });
	const manifest = generate({
		repo,
		target: "app-windows",
		version: "1.0.0",
		tag: "app-v1.0.0",
		baselineVersion: null,
		git,
		api,
	});
	assert.equal(manifest.entriesSupported, false);
	assert.equal(manifest.notes, null);
	assert.equal(manifest.baselineVersion, null);
});

test("generate applies a validated override to the exact release", () => {
	const api = baselineApi([], {});
	const git = fixtureGit({
		"app-v5.1.8": { "a.json": entry() },
	});
	const manifest = generate({
		repo,
		target: "app-android",
		version: "5.1.8",
		tag: "app-v5.1.8",
		baselineVersion: "5.1.7",
		overrideText: `  ${he("מתוקנת ידנית")}  `,
		git,
		api,
	});
	assert.equal(manifest.override, true);
	assert.equal(manifest.notes, he("מתוקנת ידנית"));
	assert.throws(
		() =>
			generate({
				repo, target: "app-android", version: "5.1.8", tag: "app-v5.1.8",
				baselineVersion: "5.1.7", overrideText: "English override",
				git, api,
			}),
		/plain Hebrew/,
	);
	assert.throws(
		() =>
			generate({
				repo, target: "app-android", version: "5.1.8", tag: "app-v5.1.8",
				baselineVersion: "5.1.7",
				overrideText: "א".repeat(TARGETS["app-android"].limit + 1),
				git, api,
			}),
		/limit/,
	);
});

test("generate validates target, version and tag binding", () => {
	const git = fixtureGit({});
	const api = baselineApi([], {});
	for (const [over, pattern] of [
		[{ target: "web" }, /Unknown store-notes target/],
		[{ version: "5.1" }, /Invalid release version/],
		[{ tag: "app-v5.1.9" }, /exact app-v/],
		[{ target: "app-store-public", baselineVersion: undefined }, /baseline-version/],
	]) {
		assert.throws(
			() =>
				generate({
					repo,
					target: "app-android",
					version: "5.1.8",
					tag: "app-v5.1.8",
					baselineVersion: "5.1.7",
					git,
					api,
					...over,
				}),
			pattern,
		);
	}
	assert.equal(ENTRIES_DIR, "app/store-release-notes");
});
