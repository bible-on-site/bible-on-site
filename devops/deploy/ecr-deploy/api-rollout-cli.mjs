import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { APIRolloutAWS, createAWSCaller } from "./api-rollout-aws.mjs";
import { PublicAPIMonitor } from "./api-public-monitor.mjs";
import { createPublicTransport } from "./api-public-transport.mjs";
import { runAPIRollout } from "./api-rollout.mjs";

export async function deployAPIWithHandover({
	config,
	deployer,
	journal = process.env.API_ROLLOUT_JOURNAL,
	dependencies = {},
}) {
	const file =
		journal ?? join(tmpdir(), "api-handover-" + randomUUID() + ".ndjson");
	writeFileSync(file, "", { flag: "wx", mode: 0o600 });
	const record = (event, value) =>
		appendFileSync(file, JSON.stringify({ event, value }) + "\n");
	let caller, transport;
	console.info("API handover journal:", file);
	try {
		caller = (dependencies.createCaller ?? createAWSCaller)(config);
		transport = (dependencies.createTransport ?? createPublicTransport)();
		const aws = new APIRolloutAWS({ call: caller.call, record });
		const version = await deployer.getLocalVersion();
		const monitor = new PublicAPIMonitor({
			request: transport.request,
			versions: [version],
			record,
		});
		return await (dependencies.run ?? runAPIRollout)({
			aws,
			monitor,
			publish: () => deployer.deploy(),
			version,
			record,
		});
	} catch (error) {
		record("cli-failed", { name: error.name, code: error.code ?? null });
		// No SDK response, task-definition body, environment or chained error is logged.
		throw new Error(
			`API deployment failed (${error.name}); inspect the API handover journal`,
		);
	} finally {
		if (transport) {
			record("public-transport", {
				requests: transport.observations,
				dns: transport.dnsObservations,
			});
			transport.close();
		}
		caller?.close();
	}
}
