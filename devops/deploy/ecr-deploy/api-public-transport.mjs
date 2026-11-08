import assert from "node:assert/strict";
import https from "node:https";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";

export const API_ORIGINS = [
	"https://api.xn--febl3a.co.il",
	"https://api.xn--febl3a.com",
];
export const HTTP_BUDGET_MS = 2000;
const hosts = new Set(API_ORIGINS.map((origin) => new URL(origin).hostname));

export function parseDNSResponse(host, response) {
	assert.ok(hosts.has(host), "Unapproved public DNS hostname");
	assert.equal(response.Status, 0, "Public DNS lookup failed");
	const answers = response.Answer;
	assert.ok(
		Array.isArray(answers) && answers.length > 0,
		"Empty public DNS answer",
	);
	assert.ok(
		answers.every(
			(answer) =>
				[1, 5].includes(answer.type) &&
				Number.isInteger(answer.TTL) &&
				answer.TTL >= 0,
		),
		"Unsupported public DNS answer",
	);
	const addresses = answers
		.filter((answer) => answer.type === 1)
		.map((answer) => answer.data);
	assert.ok(
		addresses.length > 0 && addresses.every((address) => isIP(address) === 4),
		"Invalid public DNS address",
	);
	return { addresses, ttl: Math.min(...answers.map((answer) => answer.TTL)) };
}

export class DNSCache {
	constructor(now = () => performance.now()) {
		this.now = now;
		this.values = new Map();
	}
	get(host) {
		const value = this.values.get(host);
		if (!value || value.expires <= this.now()) {
			this.values.delete(host);
			return null;
		}
		return value.addresses;
	}
	set(host, addresses, ttl) {
		assert.ok(Number.isInteger(ttl) && ttl >= 0, "Invalid DNS TTL");
		this.values.set(host, { addresses, expires: this.now() + ttl * 1000 });
	}
}

/** Original hostnames/SNI and verified TLS; one request, with no HTTP retries.
 * Reuse sockets and authoritative DNS TTLs instead of rebuilding DNS/TLS per sample.
 */
export function createPublicTransport({
	httpsClient = https,
	now = () => performance.now(),
} = {}) {
	const agentOptions = {
		keepAlive: true,
		minVersion: "TLSv1.2",
		rejectUnauthorized: true,
	};
	const agent = new httpsClient.Agent({
		...agentOptions,
		maxSockets: 4,
		maxFreeSockets: 2,
	});
	const dnsAgent = new httpsClient.Agent({
		...agentOptions,
		maxSockets: 2,
		maxFreeSockets: 1,
	});
	const cache = new DNSCache(now),
		observations = [],
		dnsObservations = [];
	async function resolve(host, signal) {
		assert.ok(hosts.has(host));
		signal.throwIfAborted();
		const cached = cache.get(host);
		if (cached) {
			dnsObservations.push({ host, cacheHit: true });
			return cached;
		}
		const started = now();
		try {
			const result = await new Promise((resolveResponse, rejectResponse) => {
				const request = httpsClient.request(
					new URL(
						"https://1.1.1.1/dns-query?name=" +
							encodeURIComponent(host) +
							"&type=A",
					),
					{
						agent: dnsAgent,
						signal,
						minVersion: "TLSv1.2",
						rejectUnauthorized: true,
						headers: { Accept: "application/dns-json" },
					},
					(response) => {
						const socket = response.socket,
							chunks = [];
						let bytes = 0;
						response.on("data", (chunk) => {
							bytes += chunk.length;
							if (bytes > 65536) {
								const error = new Error("DNS response exceeds 64 KiB");
								rejectResponse(error);
								request.destroy(error);
							} else chunks.push(chunk);
						});
						response.once("error", rejectResponse);
						response.once("aborted", () =>
							rejectResponse(new Error("DNS response truncated")),
						);
						response.once("end", () => {
							try {
								assert.equal(response.statusCode, 200);
								assert.equal(socket.authorized, true);
								resolveResponse(
									JSON.parse(Buffer.concat(chunks).toString("utf8")),
								);
							} catch (error) {
								rejectResponse(error);
							}
						});
					},
				);
				request.once("error", rejectResponse);
				request.end();
			});
			const { addresses, ttl } = parseDNSResponse(host, result);
			signal.throwIfAborted();
			cache.set(host, addresses, ttl);
			dnsObservations.push({
				host,
				cacheHit: false,
				elapsedMs: now() - started,
				ttlSeconds: ttl,
				addresses,
			});
			return addresses;
		} catch (error) {
			dnsObservations.push({
				host,
				cacheHit: false,
				elapsedMs: now() - started,
				error: error.name,
			});
			throw error;
		}
	}
	async function request(input, options = {}) {
		const url = new URL(input);
		assert.ok(API_ORIGINS.includes(url.origin), "Unapproved public origin");
		assert.ok(
			!url.username && !url.password && !url.hash,
			"Public URL must not contain credentials or fragments",
		);
		assert.equal(options.redirect, "error");
		assert.ok(options.signal);
		options.signal.throwIfAborted();
		options = {
			...options,
			signal: AbortSignal.any([
				options.signal,
				AbortSignal.timeout(HTTP_BUDGET_MS),
			]),
		};
		const method = options.method ?? "GET";
		assert.ok(["GET", "POST"].includes(method));
		const headers = Object.fromEntries(new Headers(options.headers));
		headers["user-agent"] = "Tanahpedia-API-Rollout/1";
		if (options.body !== undefined) {
			assert.equal(typeof options.body, "string");
			headers["content-length"] = Buffer.byteLength(options.body);
		}
		const started = now(),
			timing = {};
		let settled = false;
		return new Promise((resolveResponse, rejectResponse) => {
			let req;
			const fail = (error) => {
				if (settled) return;
				settled = true;
				const reason = options.signal.aborted ? options.signal.reason : error;
				observations.push({
					url: url.href,
					method,
					elapsedMs: now() - started,
					reusedSocket: req?.reusedSocket ?? false,
					...timing,
					error: { name: reason.name, code: reason.code ?? null },
				});
				rejectResponse(reason);
			};
			req = httpsClient.request(
				url,
				{
					method,
					headers,
					agent,
					signal: options.signal,
					family: 4,
					servername: url.hostname,
					minVersion: "TLSv1.2",
					rejectUnauthorized: true,
					lookup(host, lookupOptions, callback) {
						resolve(host, options.signal).then(
							(addresses) =>
								callback(
									null,
									...(lookupOptions.all
										? [addresses.map((address) => ({ address, family: 4 }))]
										: [addresses[0], 4]),
								),
							callback,
						);
					},
				},
				(response) => {
					const socket = response.socket,
						chunks = [];
					let bytes = 0;
					timing.headersMs = now() - started;
					timing.status = response.statusCode;
					timing.serverDate = response.headers.date;
					timing.certificateVerified = socket.authorized;
					response.on("data", (chunk) => {
						bytes += chunk.length;
						if (bytes > 4 * 1024 * 1024) {
							const error = new Error("Public response exceeds 4 MiB");
							fail(error);
							req.destroy(error);
						} else chunks.push(chunk);
					});
					response.once("aborted", () =>
						fail(new Error("Public response truncated")),
					);
					response.once("error", fail);
					response.once("end", () => {
						if (settled) return;
						try {
							options.signal.throwIfAborted();
							assert.equal(timing.certificateVerified, true);
							assert.ok(
								response.statusCode < 300 || response.statusCode >= 400,
								"Public redirect rejected",
							);
							assert.ok(
								now() - started <= HTTP_BUDGET_MS,
								"Whole public request exceeded2s",
							);
							const responseHeaders = new Headers();
							for (const [key, value] of Object.entries(response.headers)) {
								if (value !== undefined)
									for (const part of Array.isArray(value) ? value : [value])
										responseHeaders.append(key, part);
							}
							const result = new Response(Buffer.concat(chunks), {
								status: response.statusCode,
								headers: responseHeaders,
							});
							settled = true;
							observations.push({
								url: url.href,
								method,
								elapsedMs: now() - started,
								reusedSocket: req.reusedSocket,
								...timing,
							});
							resolveResponse(result);
						} catch (error) {
							fail(error);
						}
					});
				},
			);
			req.once("socket", (socket) => {
				if (!req.reusedSocket) {
					socket.once("lookup", () => {
						timing.dnsMs = now() - started;
					});
					socket.once("connect", () => {
						timing.tcpMs = now() - started;
					});
					socket.once("secureConnect", () => {
						timing.tlsMs = now() - started;
					});
				}
			});
			req.once("error", fail);
			req.end(options.body);
		});
	}
	return {
		request,
		observations,
		dnsObservations,
		close() {
			agent.destroy();
			dnsAgent.destroy();
		},
	};
}
