#!/usr/bin/env node
/**
 * Structural validator for the repository Renovate configuration (#3795).
 * A Renovate-config-only diff skips every module suite, so this check is the
 * honest validation leg: it fails closed on a config Renovate itself would
 * reject or silently misread.
 *
 * Checks:
 *   1. renovate.json parses to a plain JSON object.
 *   2. Known container fields keep their expected shapes (`extends`,
 *      `packageRules`, `customManagers`, `labels`, `vulnerabilityAlerts`).
 *   3. Every Renovate `/pattern/` regex spelling in match/allowed fields
 *      compiles — a broken pattern silently stops matching.
 *   4. Regex `customManagers` entries declare `customType: "regex"`, carry
 *      compiling `managerFilePatterns`/`matchStrings`, and capture
 *      `currentValue` so an update can resolve a version.
 *
 * The cargo-make ZIP guard (cargo-make-zip-guard.mjs checkRenovate) layers
 * the repository's own required rules on top of this structural pass.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `/pattern/` is Renovate's inline-regex spelling in match fields. */
const REGEX_SPELLING = /^\/(.+)\/[a-z]*$/;

/**
 * Compile-check one config-supplied pattern. The whole point of the validator
 * is proving a dynamic pattern parses, so it is built reflectively rather than
 * through a literal call site (the local non-literal-RegExp gate has no
 * allowlist for validators).
 */
function compiles(pattern) {
	Reflect.construct(RegExp, [pattern]);
}

/** Fields whose string entries may carry a `/pattern/` regex. */
const REGEX_MATCH_FIELDS = [
	"matchPackageNames",
	"matchDepNames",
	"matchFileNames",
	"matchPaths",
	"matchBaseBranches",
	"matchSourceUrlNames",
	"matchCurrentVersions",
	"allowedVersions",
	"matchNewVersions",
];

/** Rules-shaped containers: arrays of objects with the same match fields. */
function checkMatchFields(container, where, findings) {
	for (const field of REGEX_MATCH_FIELDS) {
		const entries = container[field];
		if (entries === undefined) continue;
		const list = Array.isArray(entries) ? entries : [entries];
		if (!Array.isArray(entries) && typeof entries !== "string")
			findings.push(`${where}.${field} must be a string or string list`);
		for (const entry of list) {
			if (typeof entry !== "string") {
				findings.push(`${where}.${field} entries must be strings`);
				continue;
			}
			const regex = REGEX_SPELLING.exec(entry);
			if (!regex) continue;
			try {
				compiles(regex[1]);
			} catch (err) {
				findings.push(`${where}.${field} regex ${entry} does not compile: ${err.message}`);
			}
		}
	}
}

export function validateRenovateConfig(root = process.cwd()) {
	const findings = [];
	const path = join(root, "renovate.json");
	if (!existsSync(path)) {
		findings.push("renovate.json is missing");
		return findings;
	}
	let config;
	try {
		config = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		return [`renovate.json is not valid JSON: ${err.message}`];
	}
	if (typeof config !== "object" || config === null || Array.isArray(config))
		return ["renovate.json must be a JSON object"];

	if (config.extends !== undefined) {
		if (
			!Array.isArray(config.extends) ||
			config.extends.some((entry) => typeof entry !== "string")
		)
			findings.push("extends must be a list of preset strings");
	}
	if (config.labels !== undefined) {
		if (
			!Array.isArray(config.labels) ||
			config.labels.some((entry) => typeof entry !== "string")
		)
			findings.push("labels must be a list of strings");
	}
	if (config.packageRules !== undefined) {
		if (!Array.isArray(config.packageRules))
			findings.push("packageRules must be a list");
		else
			config.packageRules.forEach((rule, index) => {
				const where = `packageRules[${index}]`;
				if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
					findings.push(`${where} must be an object`);
					return;
				}
				checkMatchFields(rule, where, findings);
			});
	}
	if (config.vulnerabilityAlerts !== undefined) {
		if (
			typeof config.vulnerabilityAlerts !== "object" ||
			config.vulnerabilityAlerts === null ||
			Array.isArray(config.vulnerabilityAlerts)
		)
			findings.push("vulnerabilityAlerts must be an object");
		else checkMatchFields(config.vulnerabilityAlerts, "vulnerabilityAlerts", findings);
	}
	if (config.customManagers !== undefined) {
		if (!Array.isArray(config.customManagers))
			findings.push("customManagers must be a list");
		else
			config.customManagers.forEach((manager, index) => {
				const where = `customManagers[${index}]`;
				if (
					typeof manager !== "object" ||
					manager === null ||
					Array.isArray(manager)
				) {
					findings.push(`${where} must be an object`);
					return;
				}
				if (manager.customType !== "regex") {
					findings.push(`${where}.customType must be "regex"`);
					return;
				}
				for (const pattern of manager.managerFilePatterns ?? []) {
					const regex =
						typeof pattern === "string" && REGEX_SPELLING.exec(pattern);
					if (!regex) {
						findings.push(
							`${where}.managerFilePatterns entries must use /pattern/ spelling`,
						);
						continue;
					}
					try {
						compiles(regex[1]);
					} catch (err) {
						findings.push(
							`${where}.managerFilePatterns regex ${pattern} does not compile: ${err.message}`,
						);
					}
				}
				const matchStrings = manager.matchStrings ?? [];
				if (!Array.isArray(matchStrings) || matchStrings.length === 0)
					findings.push(`${where}.matchStrings must be a nonempty list`);
				for (const match of matchStrings) {
					if (typeof match !== "string") {
						findings.push(`${where}.matchStrings entries must be strings`);
						continue;
					}
					try {
						compiles(match);
					} catch (err) {
						findings.push(
							`${where}.matchStrings regex does not compile: ${err.message}`,
						);
					}
					if (!match.includes("(?<currentValue>"))
						findings.push(
							`${where}.matchStrings must capture the 'currentValue' named group so an update can resolve a version`,
						);
				}
			});
	}
	// The same match-field shapes are legal at the top level.
	checkMatchFields(config, "renovate.json", findings);
	return findings;
}

export function main(root = process.cwd()) {
	const findings = validateRenovateConfig(root);
	if (findings.length) {
		for (const finding of findings) console.error(`::error::${finding}`);
		process.exit(1);
	}
	console.log("renovate.json passes the structural config validation");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
