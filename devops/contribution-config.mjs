import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
const execute = promisify(execFile);
const ACCOUNT = "250598594267",
	REGION = "il-central-1",
	SCOPE = "admin-api/contributions";
const serviceName = "bible-on-site-admin",
	cluster = "bible-on-site-cluster";

function writable(source, skeleton, readOnly) {
	for (const key of Object.keys(source))
		if (!Object.hasOwn(skeleton, key) && !readOnly.includes(key))
			throw new Error(`Unrecognized AWS configuration property: ${key}`);
	return Object.fromEntries(
		Object.entries(source).filter(([key]) => Object.hasOwn(skeleton, key)),
	);
}

/** UpdateUserPoolClient resets omitted settings. Retain every currently
 * writable field, exclude the immutable secret, and append only one scope. */
export function contributionScopePlan(client, resource, clientSkeleton) {
	if (
		client.ClientName !== "admin-service-m2m" ||
		client.AllowedOAuthFlows?.length !== 1 ||
		client.AllowedOAuthFlows[0] !== "client_credentials" ||
		!client.AllowedOAuthFlowsUserPoolClient ||
		!client.AllowedOAuthScopes?.includes("admin-api/service") ||
		resource.Identifier !== "admin-api"
	)
		throw new Error("Unexpected existing Cognito service-client contract");
	const before = writable(client, clientSkeleton, [
		"ClientSecret",
		"CreationDate",
		"LastModifiedDate",
	]);
	const after = structuredClone(before);
	after.AllowedOAuthScopes = [
		...new Set([...client.AllowedOAuthScopes, SCOPE]),
	];
	const resourceBefore = {
		UserPoolId: resource.UserPoolId,
		Identifier: resource.Identifier,
		Name: resource.Name,
		Scopes: resource.Scopes ?? [],
	};
	const resourceAfter = structuredClone(resourceBefore);
	if (
		!resourceAfter.Scopes.some((scope) => scope.ScopeName === "contributions")
	)
		resourceAfter.Scopes.push({
			ScopeName: "contributions",
			ScopeDescription:
				"Claim queued workstation generation and submit PR drafts only",
		});
	return {
		clientBefore: before,
		clientAfter: after,
		resourceBefore,
		resourceAfter,
		clientChanged: JSON.stringify(before) !== JSON.stringify(after),
		resourceChanged:
			JSON.stringify(resourceBefore) !== JSON.stringify(resourceAfter),
	};
}

export function contributionReviewerPlan(
	definition,
	skeleton,
	subject,
	tags = [],
) {
	if (
		definition.family !== serviceName ||
		!/^arn:aws:ecs:il-central-1:250598594267:task-definition\/bible-on-site-admin:\d+$/.test(
			definition.taskDefinitionArn,
		) ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
			subject,
		)
	)
		throw new Error("Unexpected reviewer or admin task definition");
	const before = writable(definition, skeleton, [
		"taskDefinitionArn",
		"revision",
		"status",
		"requiresAttributes",
		"compatibilities",
		"registeredAt",
		"registeredBy",
		"deregisteredAt",
	]);
	const userTags = tags.filter((tag) => !tag.key.startsWith("aws:"));
	if (userTags.length) before.tags = userTags;
	const after = structuredClone(before),
		container = after.containerDefinitions.find(
			(item) => item.name === "admin",
		);
	if (!container) throw new Error("Admin container missing");
	const previous = container.environment?.find(
		(item) => item.name === "TANAHPEDIA_DORADSOFT_SUB",
	)?.value;
	container.environment = [
		...(container.environment ?? []).filter(
			(item) => item.name !== "TANAHPEDIA_DORADSOFT_SUB",
		),
		{ name: "TANAHPEDIA_DORADSOFT_SUB", value: subject },
	];
	return {
		before,
		after,
		changed: previous !== subject,
		previousTaskDefinition: definition.taskDefinitionArn,
	};
}

export async function configureContributions({
	profile,
	subject,
	apply = false,
	call,
	record,
}) {
	if (apply && typeof record !== "function")
		throw new Error(
			"A private rollback receipt is required before applying configuration",
		);
	const aws =
		call ??
		(async (args, payload) => {
			try {
				const { stdout } = await execute(
					"aws",
					[
						...args,
						...(payload ? ["--cli-input-json", JSON.stringify(payload)] : []),
						"--profile",
						profile,
						"--region",
						REGION,
						"--output",
						"json",
					],
					{
						timeout: 30000,
						maxBuffer: 2097152,
						windowsHide: true,
						env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
					},
				);
				return stdout.trim() ? JSON.parse(stdout) : {};
			} catch {
				throw new Error(
					`AWS ${args[0]} ${args[1]} failed; no credentials or response bodies logged`,
				);
			}
		});
	if ((await aws(["sts", "get-caller-identity"])).Account !== ACCOUNT)
		throw new Error(
			"Contribution configuration requires the Tanahpedia account",
		);
	const current = await aws([
		"ecs",
		"describe-services",
		"--cluster",
		cluster,
		"--services",
		serviceName,
	]);
	const service = current.services?.find(
		(item) => item.serviceName === serviceName,
	);
	if (
		!service?.taskDefinition ||
		service.deployments?.length !== 1 ||
		service.pendingCount !== 0 ||
		service.runningCount !== service.desiredCount
	)
		throw new Error(
			"Wait for the existing admin deployment to become stable before configuring contributions",
		);
	const definition = await aws([
		"ecs",
		"describe-task-definition",
		"--task-definition",
		service.taskDefinition,
		"--include",
		"TAGS",
	]);
	const container = definition.taskDefinition.containerDefinitions.find(
		(item) => item.name === "admin",
	);
	const variables = Object.fromEntries(
		(container?.environment ?? []).map((item) => [item.name, item.value]),
	);
	const poolId = variables.COGNITO_USER_POOL_ID,
		clientId = variables.COGNITO_SERVICE_CLIENT_ID;
	if (!poolId || !clientId)
		throw new Error("Cognito admin and service clients must already exist");
	const pool = await aws([
		"cognito-idp",
		"describe-user-pool",
		"--user-pool-id",
		poolId,
	]);
	if (
		pool.UserPool?.Name !== serviceName ||
		!pool.UserPool.Arn?.startsWith(
			`arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/`,
		)
	)
		throw new Error("Unexpected Cognito admin user pool");
	const users = await aws([
		"cognito-idp",
		"list-users",
		"--user-pool-id",
		poolId,
		"--filter",
		`sub = "${subject}"`,
	]);
	if (
		users.Users?.length !== 1 ||
		!users.Users[0].Enabled ||
		!users.Users[0].Attributes?.some(
			(item) => item.Name === "sub" && item.Value === subject,
		)
	)
		throw new Error(
			"Reviewer must be an enabled immutable identity in the existing admin pool",
		);
	const client = await aws([
		"cognito-idp",
		"describe-user-pool-client",
		"--user-pool-id",
		poolId,
		"--client-id",
		clientId,
	]);
	const resource = await aws([
		"cognito-idp",
		"describe-resource-server",
		"--user-pool-id",
		poolId,
		"--identifier",
		"admin-api",
	]);
	const clientSkeleton = await aws([
		"cognito-idp",
		"update-user-pool-client",
		"--generate-cli-skeleton",
		"input",
	]);
	const taskSkeleton = await aws([
		"ecs",
		"register-task-definition",
		"--generate-cli-skeleton",
		"input",
	]);
	const scopes = contributionScopePlan(
		client.UserPoolClient,
		resource.ResourceServer,
		clientSkeleton,
	);
	const reviewer = contributionReviewerPlan(
		definition.taskDefinition,
		taskSkeleton,
		subject,
		definition.tags ?? [],
	);
	const tasks = await aws([
		"ecs",
		"list-tasks",
		"--cluster",
		cluster,
		"--service-name",
		serviceName,
		"--desired-status",
		"RUNNING",
	]);
	if (!tasks.taskArns?.length)
		throw new Error(
			"A running admin task is required for an image rollback receipt",
		);
	const running = await aws([
		"ecs",
		"describe-tasks",
		"--cluster",
		cluster,
		"--tasks",
		...tasks.taskArns,
	]);
	const images = running.tasks?.flatMap((task) =>
		(task.containers ?? [])
			.filter((item) => item.name === "admin")
			.map((item) => ({
				taskDefinition: task.taskDefinitionArn,
				image: item.image,
				digest: item.imageDigest,
			})),
	);
	if (
		!images?.length ||
		images.some(
			(item) =>
				item.taskDefinition !== service.taskDefinition ||
				!/^sha256:[a-f0-9]{64}$/.test(item.digest ?? ""),
		)
	)
		throw new Error(
			"Inspect the running admin image before configuring contributions",
		);
	// Only writable, non-secret settings and rollback ARNs enter the receipt.
	const receipt = {
		account: ACCOUNT,
		createdAt: new Date().toISOString(),
		previousTaskDefinition: service.taskDefinition,
		images,
		scope: SCOPE,
		scopes,
		reviewer,
	};
	await record?.(receipt);
	if (!apply)
		return {
			mode: "plan",
			account: ACCOUNT,
			workerScopeChange: scopes.clientChanged || scopes.resourceChanged,
			reviewerBindingChange: reviewer.changed,
			previousTaskDefinition: service.taskDefinition,
		};
	const fresh = await aws([
		"ecs",
		"describe-services",
		"--cluster",
		cluster,
		"--services",
		serviceName,
	]);
	if (
		fresh.services?.[0]?.taskDefinition !== service.taskDefinition ||
		fresh.services[0].deployments?.length !== 1
	)
		throw new Error(
			"Admin changed while planning; inspect the new state and retry",
		);
	if (scopes.resourceChanged)
		await aws(["cognito-idp", "update-resource-server"], scopes.resourceAfter);
	if (scopes.clientChanged)
		await aws(["cognito-idp", "update-user-pool-client"], scopes.clientAfter);
	let taskDefinition = service.taskDefinition;
	if (reviewer.changed) {
		const registered = await aws(
			["ecs", "register-task-definition"],
			reviewer.after,
		);
		taskDefinition = registered.taskDefinition?.taskDefinitionArn;
		if (
			typeof taskDefinition !== "string" ||
			!taskDefinition.startsWith(
				`arn:aws:ecs:${REGION}:${ACCOUNT}:task-definition/${serviceName}:`,
			)
		)
			throw new Error("Unexpected registered admin task definition");
		const unchanged = await aws([
			"ecs",
			"describe-services",
			"--cluster",
			cluster,
			"--services",
			serviceName,
		]);
		if (unchanged.services?.[0]?.taskDefinition !== service.taskDefinition)
			throw new Error(
				"Another admin deployment started; do not replace its task definition",
			);
		await aws([
			"ecs",
			"update-service",
			"--cluster",
			cluster,
			"--service",
			serviceName,
			"--task-definition",
			taskDefinition,
		]);
	}
	return {
		mode: "applied",
		account: ACCOUNT,
		taskDefinition,
		previousTaskDefinition: service.taskDefinition,
		workerScope: SCOPE,
		rolloutStarted: reviewer.changed,
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		const args = process.argv.slice(2),
			subject = args[args.indexOf("--reviewer-sub") + 1];
		if (!args.includes("--reviewer-sub") || !subject)
			throw new Error(
				"--reviewer-sub is required; apply is opt-in with --apply",
			);
		const profile = args.includes("--profile")
			? args[args.indexOf("--profile") + 1]
			: "AdministratorAccess-250598594267";
		const receipt = args.includes("--receipt")
			? args[args.indexOf("--receipt") + 1]
			: null;
		console.info(
			await configureContributions({
				profile,
				subject,
				apply: args.includes("--apply"),
				record: receipt
					? (value) =>
							writeFile(receipt, JSON.stringify(value, null, 2), {
								flag: "wx",
								mode: 0o600,
							})
					: undefined,
			}),
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
