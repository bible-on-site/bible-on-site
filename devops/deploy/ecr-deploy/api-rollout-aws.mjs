import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import * as ecs from "@aws-sdk/client-ecs";
import * as ecr from "@aws-sdk/client-ecr";
import * as discovery from "@aws-sdk/client-servicediscovery";
import * as events from "@aws-sdk/client-eventbridge";
import * as sts from "@aws-sdk/client-sts";
import { fromEnv, fromSSO } from "@aws-sdk/credential-providers";
import {
	API_ACCOUNT,
	API_CLUSTER,
	API_REGION,
	API_SERVICE,
} from "./api-task-protection.mjs";
import {
	API_RULE,
	DISCOVERY_ID,
	NAMESPACE_ID,
	SERVICE_ARN,
	assertDefinition,
	assertService,
	definitionArn,
	digest,
	fingerprint,
	registration,
	registrationHash,
	assertTask,
	completed,
	discoveryMatches,
	healthy,
} from "./api-rollout-state.mjs";

const modules = [ecs, ecr, discovery, events, sts];
const configurations = [
	"ECSClient",
	"ECRClient",
	"ServiceDiscoveryClient",
	"EventBridgeClient",
	"STSClient",
];
export function createAWSCaller(config, options = {}) {
	assert.equal(config.accountId, API_ACCOUNT);
	assert.equal(config.region, API_REGION);
	const credentials =
		options.credentials ??
		(config.useEnvCredentials
			? fromEnv()
			: fromSSO({ profile: config.profile }));
	const clients = modules.map(
		(module, i) =>
			new module[configurations[i]]({
				region: API_REGION,
				credentials,
				maxAttempts: 1,
				requestHandler: options.requestHandler ?? {
					connectionTimeout: 10000,
					requestTimeout: 20000,
				},
			}),
	);
	return {
		async call(operation, input) {
			const index = modules.findIndex(
				(module) => module[operation + "Command"],
			);
			assert.ok(index >= 0, "Unknown API rollout operation");
			const command = new modules[index][operation + "Command"](input);
			command.middlewareStack.add(
				(next) => async (args) => {
					const before = performance.now(),
						result = await next(args);
					Object.defineProperty(result.output, "$clock", {
						value: {
							serverDate: result.response?.headers?.date,
							elapsedMs: performance.now() - before,
						},
					});
					return result;
				},
				{
					step: "deserialize",
					priority: "high",
					name: "apiRolloutResponseClock",
				},
			);
			try {
				return await clients[index].send(command, {
					abortSignal: AbortSignal.timeout(20000),
				});
			} catch (error) {
				// AWS task definitions contain credentials. Never propagate SDK payloads.
				throw Object.assign(new Error(`${operation} failed (${error.name})`), {
					name: error.name,
					code: error.code,
					requestId: error.$metadata?.requestId,
				});
			}
		},
		close() {
			for (const client of clients) client.destroy();
		},
	};
}

export class APIRolloutAWS {
	constructor({ call, record = () => {} }) {
		this.call = call;
		this.record = record;
	}
	async service() {
		const result = await this.call("DescribeServices", {
			cluster: API_CLUSTER,
			services: [API_SERVICE],
		});
		assert.equal(result.failures?.length ?? 0, 0);
		assert.equal(result.services?.length, 1);
		const service = result.services[0];
		assertService(service);
		return service;
	}
	async definition(arn) {
		definitionArn(arn);
		const result = await this.call("DescribeTaskDefinition", {
			taskDefinition: arn,
			include: ["TAGS"],
		});
		assert.equal(result.taskDefinition?.taskDefinitionArn, arn);
		assertDefinition(result.taskDefinition);
		const tags = result.tags ?? [];
		assert.ok(Array.isArray(tags));
		return { definition: result.taskDefinition, tags };
	}
	async instances() {
		const rows = await this.call("ListInstances", {
			ServiceId: DISCOVERY_ID,
			MaxResults: 100,
		});
		const health = await this.call("GetInstancesHealthStatus", {
			ServiceId: DISCOVERY_ID,
			MaxResults: 100,
		});
		assert.ok(
			!rows.NextToken && !health.NextToken,
			"Unexpected API discovery pagination",
		);
		return rows.Instances.map((row) => ({
			id: row.Id,
			ip: row.Attributes.AWS_INSTANCE_IPV4,
			health: health.Status[row.Id],
		}));
	}
	async snapshot(oldTask = null) {
		const service = await this.service();
		const result = await this.call("ListTasks", {
			cluster: API_CLUSTER,
			serviceName: API_SERVICE,
			desiredStatus: "RUNNING",
		});
		assert.ok(
			!result.nextToken &&
				Array.isArray(result.taskArns) &&
				result.taskArns.length <= 2,
			"Unexpected API task placement",
		);
		const arns = [
			...new Set([...result.taskArns, ...(oldTask ? [oldTask] : [])]),
		];
		const tasks = arns.length
			? await this.call("DescribeTasks", { cluster: API_CLUSTER, tasks: arns })
			: { tasks: [], $clock: null };
		assert.equal(tasks.failures?.length ?? 0, 0);
		assert.equal(tasks.tasks.length, arns.length);
		return {
			service,
			tasks: tasks.tasks,
			active: result.taskArns,
			clock: tasks.$clock,
			instances: await this.instances(),
		};
	}
	async preflight() {
		const identity = await this.call("GetCallerIdentity", {});
		assert.equal(identity.Account, API_ACCOUNT);
		const rule = await this.call("DescribeRule", { Name: API_RULE });
		assert.equal(
			rule.Arn,
			`arn:aws:events:${API_REGION}:${API_ACCOUNT}:rule/${API_RULE}`,
		);
		assert.equal(
			rule.State,
			"DISABLED",
			"The API publication must have one rollout owner",
		);
		const discovery = await this.call("GetService", { Id: DISCOVERY_ID });
		assert.equal(discovery.Service.NamespaceId, NAMESPACE_ID);
		assert.deepEqual(discovery.Service.DnsConfig.DnsRecords, [
			{ Type: "A", TTL: 10 },
		]);
		const state = await this.snapshot();
		assertService(state.service, true);
		assert.equal(state.tasks.length, 1);
		assert.equal(state.active.length, 1);
		assert.equal(
			state.tasks[0].taskDefinitionArn,
			state.service.taskDefinition,
		);
		return {
			...state,
			...(await this.definition(state.service.taskDefinition)),
		};
	}
	async manifest(sha) {
		digest(sha);
		const result = await this.call("BatchGetImage", {
			repositoryName: API_SERVICE,
			imageIds: [{ imageDigest: sha }],
		});
		assert.equal(result.failures?.length ?? 0, 0);
		assert.ok(result.images?.length > 0);
		const first = result.images[0];
		assert.ok(
			result.images.every(
				(image) =>
					image.imageId?.imageDigest === sha &&
					image.imageManifest === first.imageManifest &&
					image.imageManifestMediaType === first.imageManifestMediaType &&
					"sha256:" +
						createHash("sha256").update(image.imageManifest).digest("hex") ===
						sha,
			),
			"Immutable ECR bytes do not match",
		);
		const value = JSON.parse(first.imageManifest);
		assert.equal(value.schemaVersion, 2);
		assert.equal(value.mediaType, first.imageManifestMediaType);
		return {
			value,
			bytes: first.imageManifest,
			mediaType: first.imageManifestMediaType,
		};
	}
	async image(root, architecture, nativeRoot = false) {
		const manifest = await this.manifest(root);
		let child = root;
		if (manifest.mediaType === "application/vnd.oci.image.index.v1+json") {
			const selected = manifest.value.manifests.filter(
				(row) =>
					row.platform?.os === "linux" &&
					row.platform.architecture ===
						(architecture === "ARM64" ? "arm64" : "amd64"),
			);
			assert.equal(selected.length, 1, "Expected one native image descriptor");
			child = digest(selected[0].digest);
			const native = await this.manifest(child);
			assert.equal(native.mediaType, selected[0].mediaType);
			assert.equal(Buffer.byteLength(native.bytes), selected[0].size);
			assert.ok(
				[
					"application/vnd.oci.image.manifest.v1+json",
					"application/vnd.docker.distribution.manifest.v2+json",
				].includes(native.mediaType),
			);
		} else {
			assert.ok(
				nativeRoot || architecture === "X86_64",
				"ARM latest requires a verified OCI index",
			);
			assert.ok(
				[
					"application/vnd.oci.image.manifest.v1+json",
					"application/vnd.docker.distribution.manifest.v2+json",
				].includes(manifest.mediaType),
			);
		}
		return { root, child, architecture };
	}
	async tag(tag) {
		const result = await this.call("DescribeImages", {
			repositoryName: API_SERVICE,
			imageIds: [{ imageTag: tag }],
		});
		assert.equal(result.imageDetails?.length, 1);
		return digest(result.imageDetails[0].imageDigest);
	}
	async published(version, architecture) {
		assert.match(version, /^\d+\.\d+\.\d+$/);
		const root = await this.tag("v" + version);
		assert.equal(
			await this.tag("latest"),
			root,
			"Canonical/latest ECR digest mismatch",
		);
		return this.image(root, architecture);
	}
	async register(base, tags, architecture, image) {
		const request = registration(base, tags, architecture, image);
		this.record("definition-intent", {
			architecture,
			image,
			requestSha256: registrationHash(request),
		});
		const result = await this.call("RegisterTaskDefinition", request);
		const arn = definitionArn(result.taskDefinition?.taskDefinitionArn);
		const actual = await this.definition(arn);
		assert.ok(
			isDeepStrictEqual(
				registration(
					actual.definition,
					actual.tags,
					actual.definition.runtimePlatform?.cpuArchitecture ?? "X86_64",
					actual.definition.containerDefinitions[0].image,
				),
				request,
			),
			"Registered task definition differs from preserved request",
		);
		this.record("definition-registered", {
			arn,
			architecture,
			image,
			requestSha256: registrationHash(request),
		});
		return actual.definition;
	}
	async update(
		definition,
		expectedService,
		{ source = null, beforeMutation = () => {} } = {},
	) {
		const state = source ? await this.snapshot(source.task.taskArn) : null;
		const current = state?.service ?? (await this.service());
		if (source) {
			assertService(current, true);
			assert.deepEqual(
				state.active,
				[source.task.taskArn],
				"API source task changed before mutation",
			);
			const task = state.tasks.find(
				(row) => row.taskArn === source.task.taskArn,
			);
			assertTask(task, source.definition, source.image);
			assert.ok(
				healthy(task) && discoveryMatches(state.instances, [task]),
				"API source stopped being healthy before mutation",
			);
		}
		assert.ok(
			isDeepStrictEqual(fingerprint(current), fingerprint(expectedService)),
			"API service settings changed",
		);
		assert.equal(
			current.taskDefinition,
			expectedService.taskDefinition,
			"API deployment ownership changed",
		);
		const input = {
			cluster: API_CLUSTER,
			service: API_SERVICE,
			taskDefinition: definitionArn(definition.taskDefinitionArn),
			forceNewDeployment: true,
		};
		this.record("service-update-intent", { ...input });
		beforeMutation();
		const result = await this.call("UpdateService", input);
		assert.equal(result.service?.serviceArn, SERVICE_ARN);
		assert.equal(result.service.taskDefinition, input.taskDefinition);
	}
	async rollback(baseline, target, fallback) {
		const current = await this.service();
		assert.ok(
			isDeepStrictEqual(fingerprint(current), fingerprint(baseline.service)),
			"Service settings changed before recovery",
		);
		assert.ok(
			[
				target.taskDefinitionArn,
				baseline.definition.taskDefinitionArn,
			].includes(current.taskDefinition),
			"Another deployment owns the service",
		);
		if (
			completed(current) &&
			current.taskDefinition === baseline.definition.taskDefinitionArn
		) {
			const state = await this.snapshot(baseline.task.taskArn);
			const source = state.tasks.find(
				(task) => task.taskArn === baseline.task.taskArn,
			);
			if (
				state.active.length === 1 &&
				healthy(source) &&
				discoveryMatches(state.instances, [source])
			) {
				assertTask(source, baseline.definition, baseline.image);
				return {
					definition: baseline.definition,
					image: baseline.image,
					reusedSource: true,
				};
			}
		}
		const listed = await this.call("ListServiceDeployments", {
			cluster: API_CLUSTER,
			service: API_SERVICE,
			status: [
				"PENDING",
				"IN_PROGRESS",
				"ROLLBACK_REQUESTED",
				"ROLLBACK_IN_PROGRESS",
			],
			maxResults: 100,
		});
		assert.ok(
			!listed.nextToken && listed.serviceDeployments.length <= 1,
			"Ambiguous active API deployment",
		);
		if (listed.serviceDeployments.length) {
			const arn = listed.serviceDeployments[0].serviceDeploymentArn;
			const result = await this.call("DescribeServiceDeployments", {
				serviceDeploymentArns: [arn],
			});
			assert.equal(result.failures?.length ?? 0, 0);
			assert.equal(result.serviceDeployments?.length, 1);
			const deployment = result.serviceDeployments[0];
			assert.equal(deployment.serviceArn, SERVICE_ARN);
			assert.equal(deployment.sourceServiceRevisions.length, 1);
			const source = deployment.sourceServiceRevisions[0].arn;
			const revisions = await this.call("DescribeServiceRevisions", {
				serviceRevisionArns: [source],
			});
			assert.equal(revisions.failures?.length ?? 0, 0);
			assert.equal(revisions.serviceRevisions?.length, 1);
			const revision = revisions.serviceRevisions[0];
			assert.equal(revision.serviceArn, SERVICE_ARN);
			assert.equal(
				revision.taskDefinition,
				baseline.definition.taskDefinitionArn,
			);
			assert.equal(revision.containerImages.length, 1);
			assert.equal(revision.containerImages[0].containerName, "api");
			assert.ok(
				[baseline.image.root, baseline.image.child].includes(
					revision.containerImages[0].imageDigest,
				),
				"Rollback revision lost its immutable image binding",
			);
			if (
				!["ROLLBACK_REQUESTED", "ROLLBACK_IN_PROGRESS"].includes(
					deployment.status,
				)
			) {
				this.record("rollback-intent", {
					serviceDeploymentArn: arn,
					sourceRevision: source,
					oldImage: baseline.image,
				});
				await this.call("StopServiceDeployment", {
					serviceDeploymentArn: arn,
					stopType: "ROLLBACK",
				});
			}
			return {
				definition: baseline.definition,
				image: baseline.image,
				reusedSource: true,
			};
		}
		// Completed deployments cannot be stopped. Restore an immutable native pin.
		await this.update(fallback, current);
		return {
			definition: fallback,
			image: { ...baseline.image, root: baseline.image.child },
			reusedSource: false,
		};
	}
}
