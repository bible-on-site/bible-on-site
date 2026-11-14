import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	LIGHTHOUSE_CPU_PROFILE,
	LIGHTHOUSE_CPU_TARGETS,
	lighthouseCpuProfile,
} from "./lighthouse-cpu-profile.mjs";

test("the observed CI machines emulate the same mobile CPU instead of different devices", () => {
	for (const index of [2449, 4386]) {
		const profile = lighthouseCpuProfile(index, "mobile");
		assert.ok(Math.abs(index / profile.cpuSlowdownMultiplier - 500) < 1e-9);
		assert.ok(profile.cpuSlowdownMultiplier > 4);
	}
});

test("both profiles remain consistent across faster and slower hosts", () => {
	for (const strategy of ["mobile", "desktop"]) {
		for (const index of [1500, 2000, 3000, 6000]) {
			const profile = lighthouseCpuProfile(index, strategy);
			assert.ok(
				Math.abs(
					index / profile.cpuSlowdownMultiplier -
						LIGHTHOUSE_CPU_TARGETS[strategy],
				) < 1e-9,
			);
			assert.ok(profile.cpuSlowdownMultiplier >= 1);
			assert.equal(profile.profile, LIGHTHOUSE_CPU_PROFILE);
		}
	}
});

test("unusable calibration fails before a performance result can be reported", () => {
	for (const value of [0, -1, NaN, Infinity, undefined, "2449"]) {
		assert.throws(() => lighthouseCpuProfile(value, "mobile"), /invalid/);
	}
	assert.throws(() => lighthouseCpuProfile(499, "mobile"), /cannot emulate/);
	assert.throws(() => lighthouseCpuProfile(1499, "desktop"), /cannot emulate/);
	assert.throws(() => lighthouseCpuProfile(2449, "tablet"), /Unsupported/);
});

test("the calibrated profile has a separate Bencher testbed from uncalibrated history", () => {
	assert.equal(
		LIGHTHOUSE_CPU_PROFILE,
		`cpu-m${LIGHTHOUSE_CPU_TARGETS.mobile}-d${LIGHTHOUSE_CPU_TARGETS.desktop}-v1`,
	);
	const ci = readFileSync(
		new URL("../../../.github/workflows/ci.yml", import.meta.url),
		"utf8",
	);
	assert.ok(
		ci.includes(`--testbed ubuntu-latest-lh-${LIGHTHOUSE_CPU_PROFILE}`),
	);
});
