// Android SDK install/verify for app-mobile-e2e.yml. sdkmanager treats a
// package as installed whenever its directory contains package.xml, so a
// truncated cache restore could otherwise survive every "install" and only
// fail at emulator launch. Each cached package is therefore verified by
// content, removed when corrupt, then installed with bounded retries — the
// same fallback the uncached path would take, but reached deterministically.
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

export function requiredComponents({ apiLevel, target, abi, buildTools }) {
	return [
		{
			dir: "emulator",
			package: "emulator",
			files: ["package.xml", "emulator"],
		},
		{
			dir: "platform-tools",
			package: "platform-tools",
			files: ["package.xml", "adb"],
		},
		{
			dir: join("platforms", `android-${apiLevel}`),
			package: `platforms;android-${apiLevel}`,
			files: ["package.xml", "android.jar"],
		},
		{
			dir: join("build-tools", buildTools),
			package: `build-tools;${buildTools}`,
			files: ["package.xml", "aapt2"],
		},
		{
			dir: join("system-images", `android-${apiLevel}`, target, abi),
			package: `system-images;android-${apiLevel};${target};${abi}`,
			files: ["package.xml", "system.img", "ramdisk.img"],
		},
	];
}

// A component is broken only when its directory exists but required content is
// missing; an absent directory is a normal fresh install, not corruption.
export function brokenComponents(sdkHome, components, fileExists = existsSync) {
	return components.filter(
		(component) =>
			fileExists(join(sdkHome, component.dir)) &&
			component.files.some(
				(file) => !fileExists(join(sdkHome, component.dir, file)),
			),
	);
}

async function verifyEmulator(sdkHome, execute) {
	const result = await execute(join(sdkHome, "emulator", "emulator"), ["-version"], {
		timeout: 30000,
	});
	return `${result.stdout.trim()} ${result.stderr.trim()}`.trim();
}

// execFile rejections hide the captured streams on `.stderr`/`.stdout`; surface
// them in warnings so a library or license failure is diagnosable from the log.
const describe = (error) =>
	[error.stderr?.trim(), error.stdout?.trim(), String(error)]
		.filter(Boolean)
		.join(" | ");

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const env = process.env;
	const execute = promisify(execFile);
	const sdkHome = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
	if (!sdkHome) throw new Error("Set ANDROID_HOME or ANDROID_SDK_ROOT.");
	const sdkmanager = join(
		sdkHome,
		"cmdline-tools",
		"latest",
		"bin",
		"sdkmanager",
	);
	const components = requiredComponents({
		apiLevel: env.ANDROID_API_LEVEL,
		target: env.ANDROID_TARGET,
		abi: env.ANDROID_ABI,
		buildTools: env.ANDROID_BUILD_TOOLS,
	});
	for (const component of brokenComponents(sdkHome, components)) {
		console.log(
			`::warning::Removing corrupt cached SDK package "${component.package}" at ${component.dir}; it will be downloaded again.`,
		);
		rmSync(join(sdkHome, component.dir), { recursive: true, force: true });
	}
	if (!existsSync(sdkmanager)) {
		// The runner action installs cmdline-tools and every package itself;
		// nothing here can verify or preinstall, so leave it the whole job.
		console.log(
			`::warning::sdkmanager not found at ${sdkmanager}; the emulator action installs the SDK itself.`,
		);
		process.exit(0);
	}
	// sdkmanager stops on a license prompt when stdin hits EOF; the runner
	// action accepts licenses for the same reason before installing anything.
	try {
		await execute(
			"sh",
			["-c", `yes | "${sdkmanager}" --licenses > /dev/null`],
			{ timeout: 120000 },
		);
	} catch (error) {
		console.log(
			`::warning::sdkmanager license acceptance failed: ${describe(error)}`,
		);
	}
	const packages = components.map((component) => component.package);
	let installed = false;
	for (let attempt = 1; attempt <= ATTEMPTS && !installed; attempt++) {
		try {
			const install = await execute(
				sdkmanager,
				["--install", "--channel=0", ...packages],
				{ timeout: 600000 },
			);
			if (install.stderr.trim()) console.log(install.stderr.trim());
			try {
				console.log(await verifyEmulator(sdkHome, execute));
				installed = true;
			} catch (error) {
				// sdkmanager believes the metadata, so a broken emulator survives
				// every retry unless the package directory is removed first.
				console.log(
					`::warning::Installed emulator failed -version (${describe(error)}); forcing a clean reinstall.`,
				);
				rmSync(join(sdkHome, "emulator"), { recursive: true, force: true });
			}
		} catch (error) {
			console.log(`::warning::sdkmanager install attempt ${attempt} failed: ${describe(error)}`);
		}
		if (!installed && attempt < ATTEMPTS) await delay(RETRY_DELAY_MS);
	}
	if (!installed) {
		console.log(`::error::Android SDK packages did not install and verify after ${ATTEMPTS} attempts.`);
		process.exit(1);
	}
}
