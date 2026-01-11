// Data Deployer - Populates production database with SQL files

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import * as dotenv from "dotenv";
import mysql from "mysql2/promise";
import { DeployerBase } from "../deployer-base.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({
	path: "./deploy/data-deploy/.env",
});

interface DatabaseCredentials {
	host: string;
	port: number;
	username: string;
	password: string;
	database: string;
}

// SSM Parameter names (credentials stored in SSM Parameter Store)
const SSM_PARAM_PREFIX = "bible-on-site-tanah-db";
const SSM_PARAMS = {
	username: `${SSM_PARAM_PREFIX}-username`,
	password: `${SSM_PARAM_PREFIX}-password`,
	dbname: `${SSM_PARAM_PREFIX}-name`,
} as const;

// RDS instance identifier (for getting host/port)
const RDS_INSTANCE_ID = "tanah-mysql";

class DataDeployer extends DeployerBase {
	private readonly region: string;
	private readonly dataDir: string;
	private readonly sqlFiles = [
		"tanah_structure.sql",
		"tanah_sefarim_and_perakim_data.sql",
	];

	constructor() {
		super("data");

		const region = process.env.AWS_REGION;

		if (!region) {
			throw new Error("AWS_REGION environment variable is required");
		}

		this.region = region;
		this.dataDir = path.resolve(__dirname, "../../../data/mysql");
	}

	protected override async deployPreConditions(): Promise<void> {
		this.info("Checking preconditions...");

		// Verify all SQL files exist
		for (const sqlFile of this.sqlFiles) {
			const filePath = path.join(this.dataDir, sqlFile);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Required SQL file not found: ${filePath}`);
			}
		}

		this.info("Preconditions passed.");
	}

	protected override async coreDeploy(): Promise<void> {
		this.info("Fetching database credentials...");
		const credentials = await this.getDbCredentials();

		this.info(
			`Connecting to database at ${credentials.host}:${credentials.port}...`,
		);
		const connection = await mysql.createConnection({
			host: credentials.host,
			port: credentials.port,
			user: credentials.username,
			password: credentials.password,
			database: credentials.database,
			multipleStatements: true,
		});

		try {
			for (const sqlFile of this.sqlFiles) {
				const filePath = path.join(this.dataDir, sqlFile);
				await this.executeSqlFile(connection, filePath);
			}
		} finally {
			await connection.end();
		}
	}

	private async getDbCredentials(): Promise<DatabaseCredentials> {
		const ssmClient = new SSMClient({ region: this.region });
		const rdsClient = new RDSClient({ region: this.region });

		// Fetch credentials from SSM Parameter Store (in parallel)
		this.info("Fetching credentials from SSM Parameter Store...");
		const [usernameParam, passwordParam, dbnameParam] = await Promise.all([
			ssmClient.send(
				new GetParameterCommand({
					Name: SSM_PARAMS.username,
					WithDecryption: true,
				}),
			),
			ssmClient.send(
				new GetParameterCommand({
					Name: SSM_PARAMS.password,
					WithDecryption: true,
				}),
			),
			ssmClient.send(
				new GetParameterCommand({
					Name: SSM_PARAMS.dbname,
					WithDecryption: true,
				}),
			),
		]);

		const username = usernameParam.Parameter?.Value;
		const password = passwordParam.Parameter?.Value;
		const database = dbnameParam.Parameter?.Value;

		if (!username || !password || !database) {
			throw new Error(
				"Missing required SSM parameters for database connection",
			);
		}

		// Fetch host/port from RDS instance endpoint
		this.info("Fetching endpoint from RDS...");
		const rdsResponse = await rdsClient.send(
			new DescribeDBInstancesCommand({
				DBInstanceIdentifier: RDS_INSTANCE_ID,
			}),
		);

		const dbInstance = rdsResponse.DBInstances?.[0];
		const host = dbInstance?.Endpoint?.Address;
		const port = dbInstance?.Endpoint?.Port;

		if (!host || !port) {
			throw new Error(
				`Could not get endpoint for RDS instance: ${RDS_INSTANCE_ID}`,
			);
		}

		return {
			host,
			port,
			username,
			password,
			database,
		};
	}

	private async executeSqlFile(
		connection: mysql.Connection,
		filePath: string,
	): Promise<void> {
		this.info(`Executing SQL file: ${filePath}`);

		const sql = fs.readFileSync(filePath, "utf8");

		// Split by delimiter and execute each statement
		const statements = sql
			.split(/;\s*(?=\n|$)/)
			.map((s) => s.trim())
			.filter((s) => {
				// Skip empty statements and comments
				if (s.length === 0 || s.startsWith("--")) return false;
				// Skip CREATE DATABASE and USE statements (we're already connected to the correct DB)
				if (/^(CREATE\s+DATABASE|USE\s+)/i.test(s)) return false;
				return true;
			});

		for (const statement of statements) {
			if (statement.length > 0) {
				try {
					await connection.query(statement);
				} catch (error) {
					this.error(
						`Failed to execute statement: ${statement.substring(0, 100)}...`,
					);
					throw error;
				}
			}
		}

		this.info(`Successfully executed: ${path.basename(filePath)}`);
	}
}

// Main entry point
const deployer = new DataDeployer();
await deployer.deploy();
