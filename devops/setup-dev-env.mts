import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const isWin = process.platform === "win32"; // detect Windows platform

const projectDir = path.resolve(__dirname, "..");
const devopsDir = path.resolve(projectDir, "devops");
const websiteDir = path.resolve(projectDir, "web", "bible-on-site");
const apiDir = path.resolve(projectDir, "web", "api");
const appDir = path.resolve(projectDir, "app", "BibleOnSite");

console.info("Checking cross-module prerequisites...");
assertPythonVersion();
assertNodeJSVersion();
console.info("Cross-module prerequisites are OK.");

console.info("Setting up development environment...");
console.info("Setting up devops...");
if (!setupPythonVenv(devopsDir))
	throw new Error("Failed to set up Python virtual environment for devops");

const modules = [
	{ name: "website", path: websiteDir },
	{ name: "api", path: apiDir },
	{ name: "app", path: appDir },
];
for (const module of modules) {
	const { name: moduleName, path: dir } = module;
	console.log("Checking prerequisites for module", moduleName);
	switch (moduleName) {
		case "website":
			break;
		case "api":
			assertRustVersion();
			break;
		case "app":
			assertMAUIVersion();
			break;
	}
	console.info(`Prerequesites for module ${moduleName} are OK`);
	console.info(
		`Setting up development environment for module "${moduleName}"...`,
	);
	switch (moduleName) {
		case "website":
			if (!npmInstall(websiteDir))
				throw new Error("Failed to install npm packages for website module");
			break;
		case "api":
			if (!npmInstall(path.resolve(dir, "tests")))
				throw new Error("Failed to install npm packages for API tests");
			break;
		case "app":
			break;
	}
	console.info(`Development environment for module "${moduleName}" is set up.`);
}

function setupPythonVenv(dir: string, name = ".", fullSetup = true) {
	const result = spawnSync(
		"python",
		["-m", "venv", "--prompt", name, ".venv"],
		{ cwd: dir, stdio: "inherit" },
	);
	if (result.error) {
		console.error(
			`Error creating virtual environment in ${dir}:`,
			result.error.message,
		);
		return false;
	}
	if (result.status !== 0) {
		console.error(`Error creating virtual environment in ${dir}:`);
		return false;
	}
	return fullSetup ? pipInstall(dir) : false;
}
function getActivationCommand(dir: string) {
	return isWin
		? path.join(dir, ".venv", "Scripts", "activate")
		: `source ${path.join(dir, ".venv", "bin", "activate")}`;
}

function npmInstall(dir: string) {
	const result = spawnSync("npm", ["install"], {
		cwd: dir,
		shell: isWin,
		stdio: "inherit",
	});
	if (result.error) {
		console.error(
			`Error installing npm packages in ${dir}:`,
			result.error.message,
		);
		return false;
	}
	return result.status === 0;
}

function pipInstall(dir: string, inVenv = true) {
	const command = (inVenv ? `${getActivationCommand(dir)} && ` : "").concat(
		"pip install .",
	);
	const result = spawnSync(command, {
		cwd: dir,
		stdio: "inherit",
		shell: true,
	});
	if (result.error) {
		console.error(
			`Error installing pip packages in ${dir}:`,
			result.error.message,
		);
		return false;
	}
	return result.status === 0;
}
function assertRustVersion() {
	// TODO: check using semver, TODO: inform if Rust is not installed
	console.info("Checking Rust version...");
	const supportedRustVersions = ["1.87.0"];
	const actualRustVersion = RegExp(/rustc\s+(\d+\.\d+\.\d+)/)
		.exec(
			spawnSync("rustc", ["--version"], {
				shell: isWin,
			}).stdout.toString(),
		)?.[1]
		.trim();
	if (!actualRustVersion) {
		throw new Error("Rust version not found");
	}
	if (!supportedRustVersions.includes(actualRustVersion)) {
		throw new Error(
			`Rust version ${actualRustVersion} doesn't match supported versions: ${supportedRustVersions.join(", ")}`,
		);
	}
	console.info("Rust version is OK.");
}

function assertMAUIVersion() {
	// TODO: check using semver, TODO: inform if MAUI is not installed
	console.info("Checking .NET MAUI version...");
	const supportedMauiVersions = ["9.0.100"];
	const result = spawnSync("dotnet", ["workload", "list"], {
		shell: isWin,
	});
	const output = result.stdout
		? result.stdout.toString()
		: result.output.toString();
	const match = RegExp(/maui\s+[^\n]*SDK\s+(\d+\.\d+\.\d+)/).exec(output);
	const actualMauiVersion = match ? match[1] : null;
	if (!actualMauiVersion) {
		throw new Error("MAUI version not found");
	}
	if (!supportedMauiVersions.includes(actualMauiVersion)) {
		throw new Error(
			`.NET MAUI version ${actualMauiVersion} doesn't match supported versions: ${supportedMauiVersions.join(", ")}`,
		);
	}
	console.info(".NET MAUI version is OK.");
}

function assertPythonVersion() {
	// TODO: check using semver, TODO: inform if Python is not installed
	console.info("Checking Python version...");
	const supportedPythonVersions = ["3.12.3", "3.13.1"];
	const actualPythonVersion = spawnSync("python", ["--version"], {
		shell: isWin,
	})
		.output.toString()
		.replace("Python", "")
		.replaceAll(",", "")
		.trim();
	if (!supportedPythonVersions.includes(actualPythonVersion)) {
		throw new Error(
			`Python version ${actualPythonVersion} doesn't match supported versions: ${supportedPythonVersions.join(", ")}`,
		);
	}
	console.info("Python version is OK.");
}

function assertNodeJSVersion() {
	// TODO: check using semver, TODO: inform if NodeJS is not installed.
	console.info("Checking NodeJS version...");
	const supportedNodeVersions = ["v24.11.1"];
	const actualNodeVersion = spawnSync("node", ["--version"], { shell: isWin })
		.output.toString()
		.replaceAll(",", "")
		.trim();
	if (!supportedNodeVersions.includes(actualNodeVersion)) {
		throw new Error(
			`NodeJS version ${actualNodeVersion} doesn't match supported versions: ${supportedNodeVersions.join(", ")}`,
		);
	}
	console.info("NodeJS version is OK.");
}
