import assert from "node:assert/strict";

export const API_CLUSTER = "bible-on-site-cluster";
export const API_SERVICE = "bible-on-site-api";
export const API_ACCOUNT = "250598594267";
export const API_REGION = "il-central-1";
export const LEASE_PREFIX = "tanahpedia:api-handover:";
export const PROTECTION_MINUTES = 15;
const taskPrefix = "arn:aws:ecs:il-central-1:250598594267:task/";

export function assertAPITaskArn(task) {
	assert.match(
		task,
		/^arn:aws:ecs:il-central-1:250598594267:task\/bible-on-site-cluster\/[a-f0-9]{32}$/,
	);
}
export function sameTask(received, requested) {
	assertAPITaskArn(requested);
	return (
		received === requested ||
		received === taskPrefix + requested.split("/").at(-1)
	);
}
export function expirySecond(value) {
	assert.ok(
		value instanceof Date ||
			(typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)),
		"Missing protection expiration",
	);
	const date = value instanceof Date ? value : new Date(value);
	assert.ok(Number.isFinite(date.getTime()), "Missing protection expiration");
	// UpdateTaskProtection includes fractions; GetTaskProtection truncates them.
	return Math.floor(date.getTime() / 1000);
}

/** The temporary marker and expiration bind release to this exact grant.
 * Existing protections and markers are never replaced or cleared.
 */
export class APITaskProtection {
	constructor({ call, task, nonce, record = () => {} }) {
		assertAPITaskArn(task);
		assert.match(
			nonce,
			/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/,
		);
		this.call = call;
		this.task = task;
		this.key = LEASE_PREFIX + nonce;
		this.value = JSON.stringify({ service: API_SERVICE, nonce });
		this.record = record;
		this.expiration = null;
		this.confirmed = false;
		this.tagAttempted = false;
		this.grantAttempted = false;
		this.released = false;
		this.clearConfirmed = false;
	}
	async tags() {
		const result = await this.call("ListTagsForResource", {
			resourceArn: this.task,
		});
		assert.ok(Array.isArray(result.tags), "Missing task tags");
		const entries = result.tags.map(({ key, value }) => {
			assert.equal(typeof key, "string");
			assert.equal(typeof value, "string");
			return [key, value];
		});
		assert.equal(
			new Set(entries.map(([key]) => key)).size,
			entries.length,
			"Ambiguous task tags",
		);
		return Object.fromEntries(entries);
	}
	async state() {
		const result = await this.call("GetTaskProtection", {
			cluster: API_CLUSTER,
			tasks: [this.task],
		});
		assert.equal(
			result.failures?.length ?? 0,
			0,
			"Cannot read exact task protection",
		);
		assert.equal(
			result.protectedTasks?.length,
			1,
			"Missing exact task protection",
		);
		const value = result.protectedTasks[0];
		assert.ok(
			sameTask(value.taskArn, this.task),
			"Task protection identifier mismatch",
		);
		assert.equal(typeof value.protectionEnabled, "boolean");
		return { ...value, serverDate: result.$clock?.serverDate };
	}
	async ownMarker() {
		const tags = await this.tags();
		assert.equal(tags[this.key], this.value, "Task protection marker changed");
		assert.deepEqual(
			Object.keys(tags).filter((key) => key.startsWith(LEASE_PREFIX)),
			[this.key],
			"Competing task protection marker",
		);
		return tags;
	}
	async assertActive(minimumRemainingSeconds = 0) {
		assert.ok(this.confirmed, "Task protection grant is unconfirmed");
		await this.ownMarker();
		const value = await this.state();
		assert.equal(
			value.protectionEnabled,
			true,
			"Task protection expired or changed",
		);
		assert.equal(
			expirySecond(value.expirationDate),
			this.expiration,
			"Task protection expiration changed",
		);
		if (minimumRemainingSeconds > 0) {
			const awsSecond = Math.floor(Date.parse(value.serverDate) / 1000);
			assert.ok(
				Number.isFinite(awsSecond) &&
					this.expiration - awsSecond > minimumRemainingSeconds,
				"Owned task protection is too close to expiration",
			);
		}
	}
	async grant() {
		const tags = await this.tags(),
			prior = await this.state();
		assert.equal(
			prior.protectionEnabled,
			false,
			"An existing task protection must remain unchanged",
		);
		assert.ok(
			!Object.keys(tags).some((key) => key.startsWith(LEASE_PREFIX)),
			"An existing task protection marker must remain unchanged",
		);
		this.record("protection-intent", {
			task: this.task,
			key: this.key,
			expiresInMinutes: PROTECTION_MINUTES,
		});
		this.tagAttempted = true;
		await this.call("TagResource", {
			resourceArn: this.task,
			tags: [{ key: this.key, value: this.value }],
		});
		assert.deepEqual(
			await this.ownMarker(),
			{ ...tags, [this.key]: this.value },
			"Task tags changed during lease creation",
		);
		const before = await this.state();
		assert.equal(
			before.protectionEnabled,
			false,
			"Protection appeared before the owned grant",
		);
		this.grantAttempted = true;
		let result;
		try {
			result = await this.call("UpdateTaskProtection", {
				cluster: API_CLUSTER,
				tasks: [this.task],
				protectionEnabled: true,
				expiresInMinutes: PROTECTION_MINUTES,
			});
		} catch (error) {
			// Reconcile a lost network acknowledgement without renewing the grant.
			if (
				![
					"TimeoutError",
					"AbortError",
					"RequestTimeout",
					"NetworkingError",
					"ECONNRESET",
				].includes(error.name) &&
				!["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(error.code)
			)
				throw error;
			await this.ownMarker();
			const observed = await this.state();
			const first = Math.floor(Date.parse(before.serverDate) / 1000);
			const last = Math.floor(Date.parse(observed.serverDate) / 1000);
			assert.ok(
				Number.isFinite(first) &&
					Number.isFinite(last) &&
					last >= first &&
					last - first <= 40,
				"Lost protection response has no bounded AWS clock",
			);
			const expiration = expirySecond(observed.expirationDate);
			assert.ok(
				observed.protectionEnabled &&
					expiration >= first + PROTECTION_MINUTES * 60 &&
					expiration <= last + PROTECTION_MINUTES * 60 + 1,
				"Lost protection response cannot be bound to this grant",
			);
			this.expiration = expiration;
			this.confirmed = true;
			await this.assertActive();
			this.record("protection-reconciled", {
				task: this.task,
				key: this.key,
				expiration,
				renewed: false,
			});
			return;
		}
		assert.equal(
			result.failures?.length ?? 0,
			0,
			"Task protection grant failed",
		);
		assert.equal(
			result.protectedTasks?.length,
			1,
			"Missing task protection grant receipt",
		);
		const value = result.protectedTasks[0];
		assert.ok(
			sameTask(value.taskArn, this.task) && value.protectionEnabled,
			"Unexpected task protection grant receipt",
		);
		this.expiration = expirySecond(value.expirationDate);
		this.confirmed = true;
		await this.assertActive();
		this.record("protection-confirmed", {
			task: this.task,
			key: this.key,
			expiration: this.expiration,
		});
	}
	async release() {
		if (this.released) return;
		if (!this.clearConfirmed) {
			await this.assertActive();
			this.record("protection-release-intent", {
				task: this.task,
				key: this.key,
				expiration: this.expiration,
			});
			try {
				const result = await this.call("UpdateTaskProtection", {
					cluster: API_CLUSTER,
					tasks: [this.task],
					protectionEnabled: false,
				});
				assert.equal(
					result.failures?.length ?? 0,
					0,
					"Task protection release failed",
				);
				assert.equal(
					result.protectedTasks?.length,
					1,
					"Missing task protection release receipt",
				);
				assert.ok(
					sameTask(result.protectedTasks[0].taskArn, this.task) &&
						!result.protectedTasks[0].protectionEnabled,
					"Unexpected task protection release receipt",
				);
				this.clearConfirmed = true;
			} catch (error) {
				if (
					![
						"TimeoutError",
						"AbortError",
						"RequestTimeout",
						"NetworkingError",
					].includes(error.name) &&
					!["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(error.code)
				)
					throw error;
				await this.ownMarker();
				assert.equal(
					(await this.state()).protectionEnabled,
					false,
					"Lost release acknowledgement has not cleared protection",
				);
				this.clearConfirmed = true;
			}
		}
		assert.equal(
			(await this.state()).protectionEnabled,
			false,
			"Protection still enabled after release",
		);
		await this.ownMarker();
		await this.call("UntagResource", {
			resourceArn: this.task,
			tagKeys: [this.key],
		});
		assert.ok(!(this.key in (await this.tags())), "Owned task marker remains");
		this.released = true;
		this.record("protection-released", { task: this.task, key: this.key });
	}
	async removeUngrantedMarker() {
		assert.ok(
			!this.confirmed,
			"Confirmed protection requires ownership-checked release",
		);
		const tags = await this.tags();
		if (!(this.key in tags)) return;
		assert.equal(
			tags[this.key],
			this.value,
			"Task marker belongs to another owner",
		);
		assert.equal(
			(await this.state()).protectionEnabled,
			false,
			"Uncertain protection must remain untouched",
		);
		await this.call("UntagResource", {
			resourceArn: this.task,
			tagKeys: [this.key],
		});
		assert.ok(!(this.key in (await this.tags())));
	}
}
