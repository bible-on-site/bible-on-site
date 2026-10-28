#!/usr/bin/env node
/** Reconcile an API release missed by a failed master push, without publishing. */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releasePayload } from "../release/release-provenance.mjs";
import { detectChanges } from "./determine-changes.ts";

const canonicalVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[a-f0-9]{40}$/;
const manifestPath = "web/api/Cargo.toml";
const lockPath = "web/api/Cargo.lock";

export function apiTagVersion(tag) {
	if (typeof tag !== "string" || !tag.startsWith("api-v")) return undefined;
	const version = tag.slice(5);
	return canonicalVersion.test(version) ? version : undefined;
}

export function compareVersions(left, right) {
	if (!canonicalVersion.test(left) || !canonicalVersion.test(right)) {
		throw new Error("Expected canonical API versions");
	}
	const a = left.split(".").map(BigInt);
	const b = right.split(".").map(BigInt);
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return 1;
		if (a[i] < b[i]) return -1;
	}
	return 0;
}

/** No retries or fallback: permission, transport and malformed responses are fatal. */
const requestGitHub = (endpoint) =>
	JSON.parse(
		execFileSync("gh", ["api", endpoint], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		}),
	);

export function latestPublishedApiRelease(repo, request = requestGitHub) {
	let latest;
	for (let page = 1; ; page++) {
		const releases = request(
			`repos/${repo}/releases?per_page=100&page=${page}`,
		);
		if (!Array.isArray(releases)) throw new Error("Invalid release listing");
		for (const release of releases) {
			if (!release || typeof release !== "object") {
				throw new Error("Invalid release metadata");
			}
			const version = apiTagVersion(release.tag_name);
			if (!version) continue;
			if (
				typeof release.draft !== "boolean" ||
				typeof release.prerelease !== "boolean"
			) {
				throw new Error("Missing API release publication state");
			}
			if (release.draft || release.prerelease) continue;
			if (
				!release.published_at ||
				!Number.isFinite(Date.parse(release.published_at))
			) {
				throw new Error("Missing API release publication time");
			}
			if (
				!latest ||
				compareVersions(version, apiTagVersion(latest.tag_name)) > 0
			) {
				latest = release;
			}
		}
		if (releases.length < 100) break;
	}
	if (!latest) throw new Error("No published canonical API release exists");
	return latest;
}

export function publishedReleaseCommit(repo, release, request = requestGitHub) {
	const tag = release.tag_name;
	if (!apiTagVersion(tag)) throw new Error("Invalid API release tag");
	const ref = request(`repos/${repo}/git/ref/tags/${tag}`);
	if (ref?.ref !== `refs/tags/${tag}`)
		throw new Error("API tag lookup returned another ref");
	let object = ref.object;
	const visited = new Set();
	while (object?.type === "tag") {
		if (
			!commitPattern.test(object.sha) ||
			visited.has(object.sha) ||
			visited.size >= 10
		) {
			throw new Error("Invalid annotated API tag chain");
		}
		visited.add(object.sha);
		object = request(`repos/${repo}/git/tags/${object.sha}`)?.object;
	}
	if (object?.type !== "commit" || !commitPattern.test(object.sha)) {
		throw new Error("Published API tag does not resolve to a commit");
	}
	const payload = releasePayload(release);
	if (payload && payload.ref !== object.sha) {
		throw new Error("Published API delivery source differs from its tag");
	}
	return object.sha;
}

function uniqueField(text, name) {
	const pattern =
		name === "name"
			? /^([ \t]*name[ \t]*=[ \t]*")([^"\r\n]+)(")/gm
			: /^([ \t]*version[ \t]*=[ \t]*")([^"\r\n]+)(")/gm;
	const fields = [...text.matchAll(pattern)];
	if (fields.length !== 1) throw new Error(`Expected one Cargo ${name} field`);
	return fields[0];
}
/** Mask only the API's own package version, keeping every dependency byte. */
export function normalizeApiCargo(manifest, lock) {
	const headers = [
		...manifest.matchAll(/^\[package\][ \t]*(?:#[^\r\n]*)?\r?$/gm),
	];
	if (headers.length !== 1)
		throw new Error("Expected one Cargo [package] section");
	const start = headers[0].index + headers[0][0].length;
	const rest = manifest.slice(start);
	const next = /^[ \t]*\[/m.exec(rest);
	const body = rest.slice(0, next?.index ?? rest.length);
	const name = uniqueField(body, "name")[2];
	const versionField = uniqueField(body, "version");
	const version = versionField[2];
	if (!canonicalVersion.test(version))
		throw new Error("Invalid API package version");
	const blocks = [
		...lock.matchAll(/^\[\[package\]\][ \t]*(?:#[^\r\n]*)?\r?$/gm),
	];
	const own = [];
	for (let i = 0; i < blocks.length; i++) {
		const blockStart = blocks[i].index + blocks[i][0].length;
		const blockEnd = blocks[i + 1]?.index ?? lock.length;
		const block = lock.slice(blockStart, blockEnd);
		const packageName = uniqueField(block, "name")[2];
		if (packageName !== name || /^[ \t]*source[ \t]*=/m.test(block)) continue;
		const field = uniqueField(block, "version");
		if (field[2] !== version)
			throw new Error("API manifest and own lock version differ");
		own.push({ start: blockStart, field });
	}
	if (own.length !== 1)
		throw new Error("Expected one source-less API lock package");
	const mask = (text, offset, field) => {
		const begin = offset + field.index + field[1].length;
		return `${text.slice(0, begin)}<api-version>${text.slice(begin + field[2].length)}`;
	};
	return {
		version,
		manifest: mask(manifest, start, versionField),
		lock: mask(lock, own[0].start, own[0].field),
	};
}

const runGit = (args) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

function apiTree(ref, git) {
	const entries = new Map();
	for (const entry of git(["ls-tree", "-r", "-z", ref, "--", "web/api"]).split(
		"\0",
	)) {
		if (!entry) continue;
		const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(
			entry,
		);
		if (!match) throw new Error("Invalid API Git tree entry");
		const [, mode, type, oid, file] = match;
		if (detectChanges([file]).api.module_changed)
			entries.set(file, { mode, type, oid });
	}
	return entries;
}

export function pendingApiRelease({
	repo,
	headSha,
	request = requestGitHub,
	git = runGit,
}) {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? ""))
		throw new Error("Invalid repository");
	if (!commitPattern.test(headSha ?? ""))
		throw new Error("An immutable API source SHA is required");
	if (git(["rev-parse", "HEAD"]).trim() !== headSha)
		throw new Error("Checkout differs from API source SHA");
	const release = latestPublishedApiRelease(repo, request);
	const baselineSha = publishedReleaseCommit(repo, release, request);
	git(["fetch", "--no-tags", "--depth=1", "origin", baselineSha]);
	if (
		git(["rev-parse", "--verify", `${baselineSha}^{commit}`]).trim() !==
		baselineSha
	) {
		throw new Error("Published API source could not be fetched");
	}
	const baseline = apiTree(baselineSha, git);
	const current = apiTree(headSha, git);
	const cargo = (ref, tree) => {
		if (
			[manifestPath, lockPath].some((file) => tree.get(file)?.type !== "blob")
		) {
			throw new Error("API source lacks Cargo manifest/lock blobs");
		}
		return normalizeApiCargo(
			git(["show", `${ref}:${manifestPath}`]),
			git(["show", `${ref}:${lockPath}`]),
		);
	};
	const before = cargo(baselineSha, baseline);
	const after = cargo(headSha, current);
	if (before.version !== apiTagVersion(release.tag_name))
		throw new Error("Published API source version differs from its tag");
	const changed = [...new Set([...baseline.keys(), ...current.keys()])].filter(
		(file) => {
			const a = baseline.get(file),
				b = current.get(file);
			if (!a || !b || a.mode !== b.mode || a.type !== b.type) return true;
			if (a.oid === b.oid) return false;
			if (file === manifestPath) return before.manifest !== after.manifest;
			if (file === lockPath) return before.lock !== after.lock;
			return true;
		},
	);
	if (changed.length && compareVersions(after.version, before.version) <= 0) {
		throw new Error(
			"Unreleased API source requires a version newer than the published release",
		);
	}
	return {
		pending: changed.length > 0,
		baselineTag: release.tag_name,
		baselineSha,
		reason: changed.length
			? "unreleased API production changes"
			: "API matches the published release after own-version normalization",
		changedFiles: changed.sort(),
	};
}

export function main(env = process.env, dependencies = {}) {
	const result =
		env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF === "refs/heads/master"
			? pendingApiRelease({
					repo: env.GITHUB_REPOSITORY,
					headSha: env.GITHUB_SHA,
					...dependencies,
				})
			: {
					pending: false,
					baselineTag: "",
					baselineSha: "",
					reason: "not a master push",
					changedFiles: [],
				};
	console.log(JSON.stringify(result));
	if (env.GITHUB_OUTPUT)
		appendFileSync(
			env.GITHUB_OUTPUT,
			`api_release_pending=${result.pending}\napi_release_baseline_tag=${result.baselineTag}\napi_release_baseline_sha=${result.baselineSha}\napi_release_reason=${result.reason}\n`,
		);
	return result;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main();
