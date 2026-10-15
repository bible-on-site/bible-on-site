import assert from "node:assert/strict";
import { test } from "node:test";
import {
	extractFlightIds,
	harvestDeployedFlightIds,
} from "./ms-store-flights.mjs";

const flightA = "2d244323-fa1d-4fd0-846a-a4b43c1bcfee";
const flightB = "fd001b8d-e750-4d17-8d10-2cf706567ef2";
const flightC = "06686ee7-14d3-4350-aa87-e934db6c3ad3";

/**
 * Mirrors the exact verbose `msstore flights create` output that fooled the
 * JSON parser in app CD run 168: the flight JSON sits between banner and
 * shutdown log lines.
 */
const verboseCreateLog = (id) => `08:59:04 info: Microsoft.Hosting.Lifetime[14]
Now listening on: http://localhost:1
✅ Created Flight
{
  "FlightId": "${id}",
  "FriendlyName": "v5.0.169-20261018-085904"
}
09:00:32 info: Microsoft.Hosting.Lifetime[0]
Application is shutting down...`;

test("extractFlightIds pulls the created flight id out of mixed verbose output", () => {
	assert.deepEqual(extractFlightIds(verboseCreateLog(flightA)), [flightA]);
});

test("extractFlightIds finds every pattern the deploy step writes", () => {
	const log = [
		`Creating new flight: v5.0.169 (attempt 1/3)`,
		verboseCreateLog(flightA),
		`[INF] Created flight with ID: ${flightB}`,
		`Deploying to flight: ${flightC} (internal testing)`,
	].join("\n");
	assert.deepEqual(extractFlightIds(log), [flightA, flightB, flightC]);
});

test("extractFlightIds keeps first-appearance order and de-duplicates", () => {
	const log = [
		verboseCreateLog(flightB),
		`Created flight with ID: ${flightB.toUpperCase()}`,
		verboseCreateLog(flightA),
		`Deploying to flight: ${flightB}`,
	].join("\n");
	assert.deepEqual(extractFlightIds(log), [flightB, flightA]);
});

test("extractFlightIds ignores noise, partial ids and empty input", () => {
	assert.deepEqual(extractFlightIds(""), []);
	assert.deepEqual(extractFlightIds(null), []);
	assert.deepEqual(
		extractFlightIds(
			'group id "2d244323-fa1d-4fd0-846a-a4b43c1bcfe" is too short',
		),
		[],
	);
});

const runsResponse = (...ids) => ({
	workflow_runs: ids.map((id) => ({ id })),
});
const jobsResponse = (...jobs) => ({ jobs });

test("harvestDeployedFlightIds returns ids oldest first across runs and jobs", async () => {
	const calls = [];
	const api = async (endpoint) => {
		calls.push(endpoint);
		if (endpoint.includes("/runs?")) return runsResponse(300, 200);
		if (endpoint.includes("/runs/200/jobs"))
			return jobsResponse(
				{ id: 20, name: "Deploy to Microsoft Store" },
				{ id: 21, name: "Deploy to Google Play (Internal Track)" },
			);
		if (endpoint.includes("/runs/300/jobs"))
			return jobsResponse({ id: 30, name: "Deploy to Microsoft Store" });
		throw new Error(`unexpected api call ${endpoint}`);
	};
	const apiText = async (endpoint) => {
		if (endpoint.includes("/jobs/20/logs"))
			return verboseCreateLog(flightA) + `\nCreated flight with ID: ${flightB}`;
		if (endpoint.includes("/jobs/30/logs"))
			return `Deploying to flight: ${flightB}\n` + verboseCreateLog(flightC);
		throw new Error(`unexpected log call ${endpoint}`);
	};
	const result = await harvestDeployedFlightIds({ repo: "o/r", api, apiText });
	// run 200 is older than 300, so flightA/B precede flightC; flightB repeats
	// in run 300 and must not move to the back or duplicate.
	assert.deepEqual(result.flightIds, [flightA, flightB, flightC]);
	assert.equal(result.scannedRuns, 2);
	assert.equal(result.scannedJobs, 2);
});

test("harvestDeployedFlightIds tolerates job/log fetch failures per run", async () => {
	const api = async (endpoint) => {
		if (endpoint.includes("/runs?")) return runsResponse(300, 200);
		if (endpoint.includes("/runs/200/jobs")) throw new Error("API down");
		if (endpoint.includes("/runs/300/jobs"))
			return jobsResponse({ id: 30, name: "Deploy to Microsoft Store" });
		throw new Error(`unexpected api call ${endpoint}`);
	};
	const apiText = async (endpoint) => {
		if (endpoint.includes("/jobs/30/logs")) throw new Error("log expired");
		return "";
	};
	const result = await harvestDeployedFlightIds({ repo: "o/r", api, apiText });
	assert.deepEqual(result.flightIds, []);
	assert.equal(result.scannedJobs, 1);
});

test("harvestDeployedFlightIds requires a repo argument", async () => {
	await assert.rejects(() => harvestDeployedFlightIds({}), /requires `repo`/);
});
