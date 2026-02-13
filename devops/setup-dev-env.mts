import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
	AuthorizeSecurityGroupIngressCommand,
	EC2Client,
	RevokeSecurityGroupIngressCommand,
} from "@aws-sdk/client-ec2";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory
const isWin = process.platform === "win32"; // detect Windows platform

const projectDir = path.resolve(__dirname, "..");
const devopsDir = path.resolve(projectDir, "devops");
const websiteDir = path.resolve(projectDir, "web", "bible-on-site");
const apiDir = path.resolve(projectDir, "web", "api");
const appDir = path.resolve(projectDir, "app", "BibleOnSite");

async function main() {
	const subcommand = process.argv[2];
	if (subcommand === "sync-from-prod") {
		await runSyncFromProd();
		return;
	}
	if (subcommand === "decompress-perushim-notes") {
		decompressPerushimNotes();
		return;
	}

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
				decompressPerushimNotes();
				break;
		}
		console.info(
			`Development environment for module "${moduleName}" is set up.`,
		);
	}
}

// --- decompress perushim notes (.gz → .sqlite) ---

function decompressPerushimNotes(): void {
	const assetPackDir = path.resolve(
		appDir,
		"Platforms",
		"Android",
		"AssetPacks",
		"perushim_notes",
	);
	const gzPath = path.join(
		assetPackDir,
		"sefaria-dump-5784-sivan-4.perushim_notes.sqlite.gz",
	);
	const sqlitePath = gzPath.replace(".gz", "");

	if (fs.existsSync(sqlitePath)) {
		console.info("Perushim notes SQLite already exists — skipping decompress.");
		return;
	}
	if (!fs.existsSync(gzPath)) {
		console.info(
			"Perushim notes .gz not found — skipping (run: cd data && cargo make generate-perushim-view-sqlite).",
		);
		return;
	}

	console.info("Decompressing perushim notes...");
	const compressed = fs.readFileSync(gzPath);
	const decompressed = zlib.gunzipSync(compressed);
	fs.writeFileSync(sqlitePath, decompressed);
	console.info(
		`  ${(compressed.length / 1_048_576).toFixed(1)} MB → ${(decompressed.length / 1_048_576).toFixed(1)} MB`,
	);
}

// --- sync-from-prod subcommand ---

const DEV_SYNC_TAG = "dev-sync";

interface MysqlUrlParts {
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
}

function parseMysqlUrl(url: string): MysqlUrlParts {
	const u = new URL(url);
	if (u.protocol !== "mysql:")
		throw new Error(`Expected mysql: URL, got ${u.protocol}`);
	const port = u.port ? Number.parseInt(u.port, 10) : 3306;
	const database = u.pathname ? u.pathname.slice(1) : "";
	return {
		host: u.hostname,
		port,
		user: decodeURIComponent(u.username),
		password: decodeURIComponent(u.password),
		database,
	};
}

async function getPublicIp(): Promise<string> {
	const res = await fetch("https://checkip.amazonaws.com");
	if (!res.ok) throw new Error("Failed to get public IP");
	return (await res.text()).trim();
}

// Hardcoded defaults for production environment
const PROD_AWS_REGION = "il-central-1";
const PROD_RDS_SG_NAME = "tanah-rds-sg";
const PROD_SSM_DB_URL_PARAM = "/bible-on-site-tanah-db-url";
const PROD_S3_BUCKET_DEFAULT = "bible-on-site-assets";
const DEV_S3_BUCKET_DEFAULT = "bible-on-site-assets-dev";

function fetchSsmParameter(name: string, region: string): string {
	console.info(`Fetching SSM parameter ${name}...`);
	const result = spawnSync(
		"aws",
		[
			"ssm",
			"get-parameter",
			"--name",
			name,
			"--with-decryption",
			"--query",
			"Parameter.Value",
			"--output",
			"text",
			"--region",
			region,
		],
		{ shell: isWin, encoding: "utf-8" },
	);
	if (result.status !== 0 || !result.stdout?.trim()) {
		throw new Error(
			`Failed to fetch SSM parameter ${name}: ${result.stderr || "empty result"}`,
		);
	}
	return result.stdout.trim();
}

function fetchSecurityGroupId(sgName: string, region: string): string {
	console.info(`Fetching security group ID for ${sgName}...`);
	const result = spawnSync(
		"aws",
		[
			"ec2",
			"describe-security-groups",
			"--filters",
			`Name=group-name,Values=${sgName}`,
			"--query",
			"SecurityGroups[0].GroupId",
			"--output",
			"text",
			"--region",
			region,
		],
		{ shell: isWin, encoding: "utf-8" },
	);
	if (
		result.status !== 0 ||
		!result.stdout?.trim() ||
		result.stdout.trim() === "None"
	) {
		throw new Error(
			`Failed to fetch security group ${sgName}: ${result.stderr || "not found"}`,
		);
	}
	return result.stdout.trim();
}

async function runSyncFromProd(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run");
	if (dryRun) console.info("[dry-run] Would execute the following steps.");

	dotenv.config({ path: path.resolve(projectDir, "data", ".dev.env") });

	// Use hardcoded region for production
	const awsRegion = process.env.AWS_REGION ?? PROD_AWS_REGION;

	// Fetch prod DB URL from SSM if not provided
	let prodDbUrl = process.env.PROD_DB_URL;
	if (!prodDbUrl) {
		prodDbUrl = fetchSsmParameter(PROD_SSM_DB_URL_PARAM, awsRegion);
	}

	const devDbUrl = process.env.DEV_DB_URL ?? process.env.DB_URL;
	if (!devDbUrl)
		throw new Error(
			"DEV_DB_URL or DB_URL is required for sync-from-prod (set in env or data/.dev.env)",
		);

	// Fetch RDS SG ID by name if not provided
	let sgId = process.env.PROD_RDS_SG_ID ?? process.env.RDS_SECURITY_GROUP_ID;
	if (!sgId) {
		sgId = fetchSecurityGroupId(PROD_RDS_SG_NAME, awsRegion);
	}

	// Default S3 buckets
	const prodS3Bucket = process.env.PROD_S3_BUCKET ?? PROD_S3_BUCKET_DEFAULT;
	const devS3Bucket = process.env.S3_BUCKET ?? DEV_S3_BUCKET_DEFAULT;
	const s3Endpoint = process.env.S3_ENDPOINT;

	const prodDb = parseMysqlUrl(prodDbUrl);
	const devDb = parseMysqlUrl(devDbUrl);

	console.info("Resolving public IP for RDS access...");
	const publicIp = await getPublicIp();
	console.info(`Public IP: ${publicIp}`);

	const ec2 = new EC2Client({ region: awsRegion });

	try {
		if (!dryRun) {
			console.info("Authorizing RDS security group ingress for your IP...");
			await ec2.send(
				new AuthorizeSecurityGroupIngressCommand({
					GroupId: sgId,
					IpPermissions: [
						{
							IpProtocol: "tcp",
							FromPort: 3306,
							ToPort: 3306,
							IpRanges: [
								{
									CidrIp: `${publicIp}/32`,
									Description: DEV_SYNC_TAG,
								},
							],
						},
					],
				}),
			);
		} else {
			console.info(
				`[dry-run] Would authorize ingress on ${sgId} for ${publicIp}/32`,
			);
		}

		// Dump from prod and restore to dev
		const dumpPath = path.join(projectDir, "data", ".sync-dump.sql");
		// RDS-friendly mysqldump flags (admin user lacks RELOAD privilege)
		const mysqldumpArgs = [
			"--skip-lock-tables",
			"--no-tablespaces",
			"--set-gtid-purged=OFF",
			"--routines",
			"--triggers",
			"--quick",
			"-h",
			prodDb.host,
			"-P",
			String(prodDb.port),
			"-u",
			prodDb.user,
			prodDb.database,
		];
		if (dryRun) {
			console.info(
				"[dry-run] Would run: MYSQL_PWD=*** mysqldump",
				mysqldumpArgs.join(" "),
				">",
				dumpPath,
			);
		} else {
			console.info("Dumping production database...");
			console.info(`Running: mysqldump ${mysqldumpArgs.join(" ")}`);
			const dumpResult = spawnSync("mysqldump", mysqldumpArgs, {
				env: { ...process.env, MYSQL_PWD: prodDb.password },
				stdio: ["ignore", "pipe", "pipe"],
				maxBuffer: 100 * 1024 * 1024, // 100MB buffer for large dumps
			});
			if (dumpResult.error) {
				throw new Error(`mysqldump spawn error: ${dumpResult.error.message}`);
			}
			if (dumpResult.status !== 0) {
				const stderr = dumpResult.stderr?.toString() || "";
				const stdout = dumpResult.stdout?.toString().slice(0, 500) || "";
				throw new Error(
					`mysqldump failed (exit ${dumpResult.status}): stderr=${stderr} stdout_start=${stdout}`,
				);
			}
			fs.writeFileSync(dumpPath, dumpResult.stdout);
		}

		if (dryRun) {
			console.info(
				"[dry-run] Would create dev DB if not exists and restore from dump into",
				devDb.database,
			);
			console.info(
				`[dry-run] Would migrate article content: ${PROD_S3_BUCKET_DEFAULT} → ${DEV_S3_BUCKET_DEFAULT}`,
			);
		} else {
			// Ensure dev DB exists and restore
			const createDbArgs = [
				"-h",
				devDb.host,
				"-P",
				String(devDb.port),
				"-u",
				devDb.user,
				"-e",
				`CREATE DATABASE IF NOT EXISTS \`${devDb.database}\``,
			];
			spawnSync("mysql", createDbArgs, {
				env: { ...process.env, MYSQL_PWD: devDb.password },
				stdio: "inherit",
			});
			console.info("Restoring into dev database...");
			const restoreResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					stdio: ["pipe", "inherit", "inherit"],
					input: fs.readFileSync(dumpPath),
				},
			);
			if (restoreResult.status !== 0) throw new Error("mysql restore failed");
			fs.rmSync(dumpPath, { force: true });

			// Migrate article content: replace prod S3 bucket references with dev bucket
			console.info("Migrating article content S3 references to dev bucket...");

			// Count articles with prod S3 references before migration
			const countQuery = `SELECT COUNT(*) as cnt FROM tanah_article WHERE content LIKE '%${PROD_S3_BUCKET_DEFAULT}%';`;
			const countResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
					"-N",
					"-e",
					countQuery,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					encoding: "utf-8",
				},
			);
			const beforeCount = countResult.stdout?.trim() || "0";
			console.info(
				`  Found ${beforeCount} articles with '${PROD_S3_BUCKET_DEFAULT}' references`,
			);

			// Run migration
			const migrateQuery = `
				UPDATE tanah_article
				SET content = REPLACE(content, '${PROD_S3_BUCKET_DEFAULT}', '${DEV_S3_BUCKET_DEFAULT}')
				WHERE content LIKE '%${PROD_S3_BUCKET_DEFAULT}%';
			`;
			const migrateResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
					"-v",
					"-e",
					migrateQuery,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
				},
			);

			// Show migration result
			if (migrateResult.status === 0) {
				// Extract rows affected from verbose output
				const output = migrateResult.stderr || migrateResult.stdout || "";
				const match = /Rows matched: (\d+)\s+Changed: (\d+)/.exec(output);
				if (match) {
					console.info(
						`  Migration complete: ${match[1]} rows matched, ${match[2]} rows changed`,
					);
				} else {
					console.info(`  Migration complete`);
				}
			} else {
				console.warn("Warning: S3 reference migration may have failed");
				console.warn(migrateResult.stderr || migrateResult.stdout);
			}

			// Verify: count articles still with prod S3 references (should be 0)
			// Use NOT LIKE to exclude the dev bucket which contains prod bucket name as substring
			const verifyQuery = `SELECT COUNT(*) as cnt FROM tanah_article WHERE content LIKE '%${PROD_S3_BUCKET_DEFAULT}%' AND content NOT LIKE '%${DEV_S3_BUCKET_DEFAULT}%';`;
			const verifyResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
					"-N",
					"-e",
					verifyQuery,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					encoding: "utf-8",
				},
			);
			const afterCount = verifyResult.stdout?.trim() || "0";
			if (afterCount !== "0") {
				console.warn(
					`  Warning: ${afterCount} articles still have '${PROD_S3_BUCKET_DEFAULT}' (non-dev) references after migration`,
				);
			} else {
				console.info(
					`  Verified: 0 articles with prod-only '${PROD_S3_BUCKET_DEFAULT}' references remaining`,
				);
			}

			// Count articles now with dev bucket references
			const devCountQuery = `SELECT COUNT(*) as cnt FROM tanah_article WHERE content LIKE '%${DEV_S3_BUCKET_DEFAULT}%';`;
			const devCountResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
					"-N",
					"-e",
					devCountQuery,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					encoding: "utf-8",
				},
			);
			const devCount = devCountResult.stdout?.trim() || "0";
			console.info(
				`  ${devCount} articles now have '${DEV_S3_BUCKET_DEFAULT}' references`,
			);

			// Show sample of migrated content
			const sampleQuery = `SELECT id, SUBSTRING(content, 1, 200) as sample FROM tanah_article WHERE content LIKE '%${DEV_S3_BUCKET_DEFAULT}%' LIMIT 3;`;
			const sampleResult = spawnSync(
				"mysql",
				[
					"-h",
					devDb.host,
					"-P",
					String(devDb.port),
					"-u",
					devDb.user,
					devDb.database,
					"-e",
					sampleQuery,
				],
				{
					env: { ...process.env, MYSQL_PWD: devDb.password },
					encoding: "utf-8",
				},
			);
			if (sampleResult.stdout?.trim()) {
				console.info(`  Sample migrated articles:\n${sampleResult.stdout}`);
			}
		}

		// S3 sync (optional if buckets are set)
		if (prodS3Bucket && devS3Bucket) {
			if (dryRun) {
				console.info(
					`[dry-run] Would ensure bucket s3://${devS3Bucket} exists`,
				);
				if (s3Endpoint) {
					console.info(
						`[dry-run] Would sync: AWS s3://${prodS3Bucket} → local temp → MinIO s3://${devS3Bucket}`,
					);
				} else {
					console.info(
						`[dry-run] Would run: aws s3 sync s3://${prodS3Bucket} s3://${devS3Bucket} --delete`,
					);
				}
			} else {
				// Ensure dev bucket exists (upsert principle)
				console.info(`Ensuring S3 bucket '${devS3Bucket}' exists...`);
				const mbArgs = [
					"s3",
					"mb",
					`s3://${devS3Bucket}`,
					"--region",
					awsRegion,
				];
				if (s3Endpoint) mbArgs.push("--endpoint-url", s3Endpoint);
				const mbResult = spawnSync("aws", mbArgs, {
					stdio: ["ignore", "pipe", "pipe"],
					shell: isWin,
					encoding: "utf-8",
				});
				if (mbResult.status === 0) {
					console.info(`  Created bucket '${devS3Bucket}'`);
				} else {
					const stderr = mbResult.stderr || "";
					if (
						stderr.includes("BucketAlreadyOwnedByYou") ||
						stderr.includes("BucketAlreadyExists")
					) {
						console.info(`  Bucket '${devS3Bucket}' already exists`);
					} else {
						console.warn(`  Warning: Could not create bucket: ${stderr}`);
					}
				}

				if (s3Endpoint) {
					// Two-step sync: AWS prod → local temp dir → MinIO dev
					// Required because --endpoint-url applies to both source and dest
					const tempS3Dir = path.join(projectDir, "data", ".s3-sync-temp");
					fs.mkdirSync(tempS3Dir, { recursive: true });

					console.info(
						`Downloading S3 from prod (s3://${prodS3Bucket}) to temp dir...`,
					);
					const downloadResult = spawnSync(
						"aws",
						[
							"s3",
							"sync",
							`s3://${prodS3Bucket}`,
							tempS3Dir,
							"--delete",
							"--region",
							awsRegion,
						],
						{
							stdio: ["ignore", "pipe", "pipe"],
							shell: isWin,
							encoding: "utf-8",
						},
					);
					if (downloadResult.status !== 0) {
						const stderr = downloadResult.stderr || "";
						console.warn(`  Warning: S3 download failed: ${stderr}`);
					} else {
						console.info("  S3 download complete");
						console.info(
							`Uploading to MinIO (s3://${devS3Bucket}) at ${s3Endpoint}...`,
						);
						const uploadResult = spawnSync(
							"aws",
							[
								"s3",
								"sync",
								tempS3Dir,
								`s3://${devS3Bucket}`,
								"--delete",
								"--endpoint-url",
								s3Endpoint,
							],
							{
								stdio: ["ignore", "pipe", "pipe"],
								shell: isWin,
								encoding: "utf-8",
								env: {
									...process.env,
									AWS_ACCESS_KEY_ID:
										process.env.S3_ACCESS_KEY_ID || "test",
									AWS_SECRET_ACCESS_KEY:
										process.env.S3_SECRET_ACCESS_KEY || "test_1234",
								},
							},
						);
						if (uploadResult.status !== 0) {
							const stderr = uploadResult.stderr || "";
							console.warn(`  Warning: MinIO upload failed: ${stderr}`);
						} else {
							console.info("  MinIO upload complete");
						}
					}

					// Clean up temp dir
					fs.rmSync(tempS3Dir, { recursive: true, force: true });
				} else {
					// Direct S3-to-S3 sync (both on AWS)
					console.info("Syncing S3 from prod to dev...");
					const s3Result = spawnSync(
						"aws",
						[
							"s3",
							"sync",
							`s3://${prodS3Bucket}`,
							`s3://${devS3Bucket}`,
							"--delete",
						],
						{
							stdio: ["ignore", "pipe", "pipe"],
							shell: isWin,
							encoding: "utf-8",
						},
					);
					if (s3Result.status !== 0) {
						const stderr = s3Result.stderr || "";
						console.warn(`  Warning: S3 sync failed: ${stderr}`);
					} else {
						console.info("  S3 sync complete");
					}
				}
			}
		} else if (!dryRun) {
			console.info(
				"Skipping S3 sync (set PROD_S3_BUCKET and S3_BUCKET to enable).",
			);
		}
	} finally {
		if (!dryRun) {
			console.info("Revoking RDS security group ingress...");
			try {
				await ec2.send(
					new RevokeSecurityGroupIngressCommand({
						GroupId: sgId,
						IpPermissions: [
							{
								IpProtocol: "tcp",
								FromPort: 3306,
								ToPort: 3306,
								IpRanges: [
									{
										CidrIp: `${publicIp}/32`,
										Description: DEV_SYNC_TAG,
									},
								],
							},
						],
					}),
				);
			} catch (e) {
				console.warn(
					"Revoke ingress failed (you may need to remove the rule manually):",
					e,
				);
			}
		} else {
			console.info("[dry-run] Would revoke ingress on", sgId);
		}
	}

	console.info("sync-from-prod finished.");
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
	const supportedRustVersions = ["1.92.0"];
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
	const supportedPythonVersions = ["3.14.0", "3.14.2"];
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

// Entry point
main().catch((err) => {
	console.error(err);
	process.exit(1);
});
