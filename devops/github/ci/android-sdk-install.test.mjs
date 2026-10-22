import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
	brokenComponents,
	requiredComponents,
} from "./android-sdk-install.mjs";

const COMPONENTS = requiredComponents({
	apiLevel: "36",
	target: "google_apis",
	abi: "x86_64",
	buildTools: "37.0.0",
});

test("requiredComponents covers emulator, image, platform and tools", () => {
	const packages = COMPONENTS.map((component) => component.package);
	assert.deepEqual(packages, [
		"emulator",
		"platform-tools",
		"platforms;android-36",
		"build-tools;37.0.0",
		"system-images;android-36;google_apis;x86_64",
	]);
	assert.equal(
		COMPONENTS.at(-1).dir,
		join("system-images", "android-36", "google_apis", "x86_64"),
	);
});

test("missing directory is a fresh install, not corruption", () => {
	const present = new Set();
	assert.equal(
		brokenComponents("/sdk", COMPONENTS, (path) => present.has(path)).length,
		0,
	);
});

test("directory missing package metadata or payload is corrupt", () => {
	const emulatorDir = join("/sdk", "emulator");
	const present = new Set([
		emulatorDir,
		join(emulatorDir, "package.xml"),
		// "emulator" binary is absent: a truncated restore.
	]);
	const broken = brokenComponents("/sdk", COMPONENTS, (path) =>
		present.has(path),
	);
	assert.deepEqual(
		broken.map((component) => component.package),
		["emulator"],
	);
});

test("complete directory survives verification", () => {
	const component = requiredComponents({
		apiLevel: "36",
		target: "google_apis",
		abi: "x86_64",
		buildTools: "37.0.0",
	})[0];
	const present = new Set([
		join("/sdk", component.dir),
		...component.files.map((file) => join("/sdk", component.dir, file)),
	]);
	assert.equal(
		brokenComponents("/sdk", [component], (path) => present.has(path)).length,
		0,
	);
});
