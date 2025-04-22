import * as fs from "node:fs";
import * as path from "node:path";
import * as mysql from "mysql2/promise";
import * as dotenv from "dotenv";
import { URL, fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), ".test.env") });

async function getDbConnectionDetails(): Promise<mysql.ConnectionOptions> {
	const dbUrlStr = process.env.DB_URL;
	if (dbUrlStr === undefined) {
		throw new Error("Environment variable DB_URL is required");
	}

	const dbUrl = new URL(dbUrlStr);
	const dbHost = dbUrl.hostname;
	const dbPort = dbUrl.port || "3306";
	const dbUser = dbUrl.username;
	const dbPassword = decodeURIComponent(dbUrl.password);

	return {
		host: dbHost,
		port: Number.parseInt(dbPort, 10),
		user: dbUser,
		password: dbPassword,
		multipleStatements: true,
	};
}

async function executeScript(
	connection: mysql.Connection,
	scriptPath: string,
	scriptType: string,
): Promise<void> {
	console.log(`Executing ${scriptType} script...`);
	const script = fs.readFileSync(scriptPath, "utf8");
	await connection.query(script);
	console.log(`${scriptType} script executed successfully`);
}

async function main() {
	let connection: mysql.Connection | null = null;

	try {
		const connectionOptions = await getDbConnectionDetails();

		console.log(
			`Connecting to database at ${connectionOptions.host}:${connectionOptions.port}...`,
		);
		connection = await mysql.createConnection(connectionOptions);
		console.log("Connected to database");

		const structureScriptPath = path.join(
			__dirname,
			"tanah_test_structure.sql",
		);
		await executeScript(connection, structureScriptPath, "structure");

		const dataScriptPath = path.join(__dirname, "tanah_test_data.sql");
		await executeScript(connection, dataScriptPath, "data");

		console.log("Database population completed successfully");
	} catch (error) {
		console.error("Error:", error);
		process.exit(1);
	} finally {
		if (connection) {
			await connection.end();
			console.log("Database connection closed");
		}
	}
}

await main();
