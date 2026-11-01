import { createHash } from "node:crypto";
import stableStringify from "fast-json-stable-stringify";
import { APIRolloutAWS } from "./api-rollout-aws.mjs";
import { PublicAPIMonitor, healthRoutes } from "./api-public-monitor.mjs";
import {
	API_ACCOUNT,
	API_CLUSTER,
	API_SERVICE,
	LEASE_PREFIX,
} from "./api-task-protection.mjs";
import {
	ARN,
	DISCOVERY_ID,
	IMAGE_URI,
	NAMESPACE_ID,
	READY_CHECK,
	SERVICE_ARN,
	privateIP,
} from "./api-rollout-state.mjs";

export const NOW = Date.parse("2026-11-01T00:00:00Z");
export const OLD_INSTANCE = "11111111-1111-4111-8111-111111111111";
export const NEW_INSTANCE = "22222222-2222-4222-8222-222222222222";
export const RESTORED_INSTANCE = "33333333-3333-4333-8333-333333333333";
export const taskArn = (letter) =>
	ARN + "task/" + API_CLUSTER + "/" + letter.repeat(32);
export const definitionArn = (revision) =>
	ARN + "task-definition/" + API_SERVICE + ":" + revision;
export const sha = (text) =>
	"sha256:" + createHash("sha256").update(text).digest("hex");
const IMAGE_TYPE = "application/vnd.oci.image.manifest.v1+json";
const INDEX_TYPE = "application/vnd.oci.image.index.v1+json";
export function makeImages(label) {
	const manifests = new Map(),
		children = {};
	for (const architecture of ["amd64", "arm64"]) {
		const bytes = stableStringify({
			schemaVersion: 2,
			mediaType: IMAGE_TYPE,
			config: { digest: sha(label + architecture), size: 1 },
			layers: [],
		});
		children[architecture] = sha(bytes);
		manifests.set(sha(bytes), bytes);
	}
	const bytes = stableStringify({
		schemaVersion: 2,
		mediaType: INDEX_TYPE,
		manifests: Object.entries(children).map(([architecture, digest]) => ({
			digest,
			size: Buffer.byteLength(manifests.get(digest)),
			mediaType: IMAGE_TYPE,
			platform: { architecture, os: "linux" },
		})),
	});
	manifests.set(sha(bytes), bytes);
	return { root: sha(bytes), children, manifests };
}
export function definition(
	revision = 9,
	image = IMAGE_URI + ":latest",
	architecture = "X86_64",
) {
	return {
		taskDefinitionArn: definitionArn(revision),
		family: API_SERVICE,
		revision,
		status: "ACTIVE",
		registeredAt: new Date(NOW),
		registeredBy: "existing-owner",
		requiresAttributes: [],
		compatibilities: ["EC2", "FARGATE"],
		cpu: "256",
		memory: "512",
		networkMode: "awsvpc",
		requiresCompatibilities: ["FARGATE"],
		executionRoleArn: "arn:aws:iam::250598594267:role/ecsTaskExecutionRole",
		taskRoleArn: "arn:aws:iam::250598594267:role/apiTaskRole",
		runtimePlatform: {
			operatingSystemFamily: "LINUX",
			cpuArchitecture: architecture,
		},
		volumes: [],
		placementConstraints: [],
		containerDefinitions: [
			{
				name: "api",
				image,
				essential: true,
				healthCheck: structuredClone(READY_CHECK),
				environment: [
					{ name: "PRIVATE_CANARY", value: "must-not-appear-in-journal" },
				],
				portMappings: [{ containerPort: 3003, protocol: "tcp" }],
				logConfiguration: {
					logDriver: "awslogs",
					options: { "awslogs-group": "/ecs/api" },
				},
			},
		],
	};
}
export function service(def = definition()) {
	return {
		serviceArn: SERVICE_ARN,
		serviceName: API_SERVICE,
		clusterArn: ARN + "cluster/" + API_CLUSTER,
		status: "ACTIVE",
		desiredCount: 1,
		runningCount: 1,
		pendingCount: 0,
		schedulingStrategy: "REPLICA",
		launchType: "FARGATE",
		deploymentController: { type: "ECS" },
		platformVersion: "LATEST",
		platformFamily: "Linux",
		networkConfiguration: {
			awsvpcConfiguration: {
				subnets: ["subnet-a"],
				securityGroups: ["sg-a"],
				assignPublicIp: "DISABLED",
			},
		},
		serviceRegistries: [
			{
				registryArn:
					"arn:aws:servicediscovery:il-central-1:250598594267:service/" +
					DISCOVERY_ID,
			},
		],
		deploymentConfiguration: {
			minimumHealthyPercent: 100,
			maximumPercent: 200,
			strategy: "ROLLING",
			bakeTimeInMinutes: 0,
			deploymentCircuitBreaker: {
				enable: true,
				rollback: true,
				resetOnHealthyTask: true,
				thresholdConfiguration: { type: "BOUNDED_PERCENT", value: 50 },
			},
		},
		taskDefinition: def.taskDefinitionArn,
		deployments: [
			{
				taskDefinition: def.taskDefinitionArn,
				rolloutState: "COMPLETED",
				failedTasks: 0,
			},
		],
	};
}
export function task(def, image, letter = "a", at = -60000) {
	return {
		taskArn: taskArn(letter),
		taskDefinitionArn: def.taskDefinitionArn,
		clusterArn: ARN + "cluster/" + API_CLUSTER,
		group: "service:" + API_SERVICE,
		lastStatus: "RUNNING",
		desiredStatus: "RUNNING",
		healthStatus: "HEALTHY",
		startedAt: new Date(NOW + at),
		cpu: "256",
		memory: "512",
		launchType: "FARGATE",
		attributes: [
			{
				name: "ecs.cpu-architecture",
				value:
					def.runtimePlatform.cpuArchitecture === "ARM64" ? "arm64" : "x86_64",
			},
		],
		containers: [
			{
				name: "api",
				image: def.containerDefinitions[0].image,
				imageDigest: image,
				healthStatus: "HEALTHY",
			},
		],
		attachments: [
			{
				type: "ElasticNetworkInterface",
				details: [
					{
						name: "privateIPv4Address",
						value: "172.31.0." + { a: 1, b: 2, c: 3 }[letter],
					},
				],
			},
		],
	};
}

export class Backend {
	constructor() {
		this.at = 0;
		this.calls = [];
		this.records = [];
		this.tags = { existing: "preserved" };
		this.oldImages = makeImages("old");
		this.newImages = makeImages("new");
		this.manifests = new Map([
			...this.oldImages.manifests,
			...this.newImages.manifests,
		]);
		this.definitions = new Map([[definitionArn(9), definition()]]);
		this.current = definition();
		this.original = definition();
		this.old = task(this.current, this.oldImages.root);
		this.next = null;
		this.started = null;
		this.releasedAt = null;
		this.allTasks = new Map([[this.old.taskArn, this.old]]);
		this.otherLeases = new Map();
		this.releaseTimes = new Map();
		this.protected = false;
		this.expiration = null;
		this.published = false;
		this.recovering = false;
		this.updates = 0;
	}
	evolve() {
		if (!this.next) return;
		const elapsed = this.at - this.started;
		this.next.lastStatus = elapsed >= 5000 ? "RUNNING" : "PENDING";
		this.next.healthStatus =
			elapsed >= (this.neverReady ? 35000 : 7000) ? "HEALTHY" : "UNKNOWN";
		this.next.containers[0].healthStatus = this.next.healthStatus;
		if (this.recovering) {
			this.old.lastStatus = "RUNNING";
			this.next.lastStatus = "STOPPED";
		} else
			for (const [arn, at] of this.releaseTimes) {
				const row = this.allTasks.get(arn);
				if (row && row !== this.next && this.at - at >= 5000)
					row.lastStatus = "STOPPED";
			}
	}
	state() {
		this.evolve();
		const s = service(this.current);
		if (this.next && !this.recovering) {
			const running = [...this.allTasks.values()].filter(
				(row) => row.lastStatus === "RUNNING",
			);
			const done = running.length === 1 && running[0] === this.next;
			s.runningCount = running.length;
			s.pendingCount = this.next.lastStatus === "PENDING" ? 1 : 0;
			if (!done)
				s.deployments = [
					{
						taskDefinition: this.current.taskDefinitionArn,
						rolloutState: "IN_PROGRESS",
						failedTasks: 0,
					},
					{
						taskDefinition: this.original.taskDefinitionArn,
						rolloutState: "COMPLETED",
						failedTasks: 0,
					},
				];
		}
		if (this.mutateService) this.mutateService(s);
		return s;
	}
	instances() {
		this.evolve();
		const tasks = this.recovering
			? [this.old]
			: [...this.allTasks.values()].filter(
					(row) =>
						row !== this.next ||
						this.at - this.started >= (this.discoveryAt ?? 40000),
				);
		return tasks
			.filter(
				(row) =>
					row.lastStatus === "RUNNING" ||
					(this.releaseTimes.has(row.taskArn) &&
						this.at - this.releaseTimes.get(row.taskArn) < 8000),
			)
			.map((row) => ({
				Id: row.taskArn.split("/").at(-1),
				Attributes: { AWS_INSTANCE_IPV4: privateIP(row) },
			}));
	}
	async call(name, input) {
		this.calls.push({ name, input: structuredClone(input), at: this.at });
		if (this.hook) {
			const override = await this.hook(name, input);
			if (override !== undefined) return override;
		}
		const clock = {
			serverDate: new Date(NOW + this.at).toUTCString(),
			elapsedMs: 1,
		};
		switch (name) {
			case "GetCallerIdentity":
				return { Account: API_ACCOUNT };
			case "DescribeRule":
				return {
					Arn: "arn:aws:events:il-central-1:250598594267:rule/ecr-push-bible-on-site-api",
					State: "DISABLED",
				};
			case "GetService":
				return {
					Service: {
						NamespaceId: NAMESPACE_ID,
						DnsConfig: { DnsRecords: [{ Type: "A", TTL: 10 }] },
					},
				};
			case "DescribeServices":
				return { services: [this.state()], failures: [] };
			case "DescribeTaskDefinition":
				return {
					taskDefinition: structuredClone(
						this.definitions.get(input.taskDefinition),
					),
					tags: [{ key: "existing", value: "preserve" }],
				};
			case "ListTasks":
				this.evolve();
				return {
					taskArns: [...this.allTasks.values()]
						.filter((row) => row.lastStatus !== "STOPPED")
						.map((row) => row.taskArn),
				};
			case "DescribeTasks":
				this.evolve();
				return {
					tasks: input.tasks.map((arn) =>
						structuredClone(this.allTasks.get(arn)),
					),
					failures: [],
					$clock: clock,
				};
			case "ListInstances":
				return { Instances: this.instances() };
			case "GetInstancesHealthStatus":
				return {
					Status: Object.fromEntries(
						this.instances().map((row) => [row.Id, "HEALTHY"]),
					),
				};
			case "ListTagsForResource":
				return {
					tags: Object.entries(this.lease(input.resourceArn).tags).map(
						([key, value]) => ({ key, value }),
					),
				};
			case "GetTaskProtection": {
				const lease = this.lease(input.tasks[0]);
				return {
					failures: [],
					protectedTasks: [
						{
							taskArn: input.tasks[0],
							protectionEnabled: lease.protected,
							...(lease.expiration !== null
								? {
										expirationDate: new Date(
											Math.floor(lease.expiration / 1000) * 1000,
										),
									}
								: {}),
						},
					],
					$clock: clock,
				};
			}
			case "TagResource":
				for (const row of input.tags)
					this.lease(input.resourceArn).tags[row.key] = row.value;
				return {};
			case "UntagResource":
				for (const key of input.tagKeys)
					delete this.lease(input.resourceArn).tags[key];
				return {};
			case "UpdateTaskProtection": {
				const lease = this.lease(input.tasks[0]);
				lease.protected = input.protectionEnabled;
				if (lease.protected) lease.expiration = NOW + this.at + 900000 + 134;
				else {
					lease.expiration = null;
					this.releaseTimes.set(input.tasks[0], this.at);
					if (input.tasks[0] === this.old.taskArn) this.releasedAt = this.at;
				}
				return {
					failures: [],
					protectedTasks: [
						{
							taskArn: input.tasks[0].replace(
								"task/" + API_CLUSTER + "/",
								"task/",
							),
							protectionEnabled: lease.protected,
							...(lease.expiration !== null
								? { expirationDate: new Date(lease.expiration) }
								: {}),
						},
					],
					$clock: clock,
				};
			}
			case "BatchGetImage": {
				const digest = input.imageIds[0].imageDigest,
					bytes = this.manifests.get(digest);
				return {
					images: [
						{
							imageId: { imageDigest: digest },
							imageManifest: bytes,
							imageManifestMediaType: JSON.parse(bytes).mediaType,
						},
					],
					failures: [],
				};
			}
			case "DescribeImages":
				return {
					imageDetails: [
						{
							imageDigest:
								input.imageIds[0].imageTag === "v0.1.100" || !this.published
									? this.oldImages.root
									: this.newImages.root,
							imageTags: ["cached-unrelated-alias"],
						},
					],
				};
			case "RegisterTaskDefinition": {
				const revision = 10 + this.definitions.size,
					value = {
						...structuredClone(input),
						taskDefinitionArn: definitionArn(revision),
						revision,
					};
				delete value.tags;
				this.definitions.set(value.taskDefinitionArn, value);
				return { taskDefinition: value };
			}
			case "UpdateService": {
				this.current = structuredClone(
					this.definitions.get(input.taskDefinition),
				);
				this.started = this.at;
				this.updates++;
				this.next = task(
					this.current,
					this.updates === 1
						? this.newImages.root
						: this.oldImages.children.amd64,
					this.updates === 1 ? "b" : "c",
					this.at + 5000,
				);
				if (this.next.containers[0].image.includes("@"))
					this.next.containers[0].imageDigest =
						this.next.containers[0].image.split("@")[1];
				this.allTasks.set(this.next.taskArn, this.next);
				this.recovering = false;
				this.evolve();
				return { service: this.state() };
			}
			case "ListServiceDeployments":
				return {
					serviceDeployments:
						this.old.lastStatus === "STOPPED"
							? []
							: [
									{
										serviceDeploymentArn:
											ARN +
											"service-deployment/" +
											API_CLUSTER +
											"/" +
											API_SERVICE +
											"/owned",
									},
								],
				};
			case "DescribeServiceDeployments":
				return {
					serviceDeployments: [
						{
							serviceArn: SERVICE_ARN,
							status: "IN_PROGRESS",
							sourceServiceRevisions: [{ arn: "source-revision" }],
						},
					],
					failures: [],
				};
			case "DescribeServiceRevisions":
				return {
					serviceRevisions: [
						{
							serviceArn: SERVICE_ARN,
							taskDefinition: this.original.taskDefinitionArn,
							containerImages: [
								{ containerName: "api", imageDigest: this.oldImages.root },
							],
						},
					],
					failures: [],
				};
			case "StopServiceDeployment":
				this.recovering = true;
				this.current = structuredClone(this.original);
				this.evolve();
				return {};
			default:
				throw new Error("Unknown fake operation " + name);
		}
	}
	lease(arn) {
		if (arn === this.old.taskArn) return this;
		if (!this.otherLeases.has(arn))
			this.otherLeases.set(arn, {
				protected: false,
				expiration: null,
				tags: {},
			});
		return this.otherLeases.get(arn);
	}
}

class Monitor {
	constructor(backend) {
		this.backend = backend;
		this.rows = [];
		this.index = 0;
		this.baselines = 0;
		this.contractCalls = [];
	}
	async baseline() {
		this.baselines++;
		return { version: "0.1.100", instance: this.legacy ? null : OLD_INSTANCE };
	}
	async contracts(version, expected, instance) {
		this.contractCalls.push({ version, expected, instance });
		if (this.failFinalContracts && version === "0.1.101")
			throw new Error("changed contract");
		return ["hash-only-baseline"];
	}
	start() {
		this.running = true;
	}
	async stop() {
		this.running = false;
	}
	sample() {
		const b = this.backend;
		let version = "0.1.100",
			instance = this.legacy ? null : OLD_INSTANCE;
		if (
			b.next &&
			!b.recovering &&
			b.at - b.started >= (this.publicAt ?? 42000)
		) {
			version = b.updates === 1 ? "0.1.101" : "0.1.100";
			instance =
				b.updates === 1 ? NEW_INSTANCE : this.legacy ? null : RESTORED_INSTANCE;
		}
		const failed = this.failPublic && b.next && !b.recovering;
		const route = healthRoutes[this.index++ % 4];
		this.rows.push({ passed: !failed, route, version, instance });
	}
	assertHealthy = PublicAPIMonitor.prototype.assertHealthy;
	instance = PublicAPIMonitor.prototype.instance;
	sawProcess = PublicAPIMonitor.prototype.sawProcess;
}
export function fixture() {
	const backend = new Backend(),
		monitor = new Monitor(backend);
	const record = (name, value) =>
		backend.records.push({
			name,
			value: structuredClone(value),
			at: backend.at,
		});
	const aws = new APIRolloutAWS({ call: backend.call.bind(backend), record });
	return {
		backend,
		monitor,
		aws,
		record,
		version: "0.1.101",
		nonce: "1".repeat(32),
		now: () => backend.at,
		wait: async (ms) => {
			backend.at += ms;
			monitor.sample();
		},
		publish: async () => {
			backend.published = true;
		},
	};
}

export const ownedTags = (backend) =>
	Object.keys(backend.tags).filter((key) => key.startsWith(LEASE_PREFIX));
