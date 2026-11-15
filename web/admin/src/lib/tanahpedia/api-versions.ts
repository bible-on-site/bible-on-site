/**
 * Explicit, transitive API-contract conversion. Reverse conversion requires its
 * own adapter. Adapters may remove obsolete fields or operations; conversion
 * has no effect on review or approval policy.
 */
interface ApiVersionEdge {
	from: number;
	to: number;
	id: string;
}
export interface ApiVersionAdapter<T> extends ApiVersionEdge {
	convert: (payload: T) => T;
}
export interface AsyncApiVersionAdapter<T> extends ApiVersionEdge {
	convert: (payload: T) => T | Promise<T>;
}

export interface ApiVersionConversion<T> {
	from: number;
	to: number;
	payload: T;
	steps: { from: number; to: number; id: string }[];
}

export class ApiVersionError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "ApiVersionError";
	}
}

function validVersion(version: number): void {
	if (!Number.isSafeInteger(version) || version < 1)
		throw new ApiVersionError("API versions must be positive integers");
}

/**
 * Compose the shortest directed route, including reverse adapters if registered.
 */
function apiVersionPath<A extends ApiVersionEdge>(
	from: number,
	to: number,
	adapters: readonly A[],
): A[] {
	validVersion(from);
	validVersion(to);
	const edges = new Map<number, A[]>();
	const ids = new Set<string>(),
		pairs = new Set<string>();
	for (const adapter of adapters) {
		validVersion(adapter.from);
		validVersion(adapter.to);
		const pair = `${adapter.from}:${adapter.to}`;
		if (
			!adapter.id.trim() ||
			ids.has(adapter.id) ||
			pairs.has(pair) ||
			adapter.from === adapter.to
		)
			throw new ApiVersionError(
				"API adapters require unique IDs and unique directed version pairs",
			);
		ids.add(adapter.id);
		pairs.add(pair);
		edges.set(adapter.from, [...(edges.get(adapter.from) ?? []), adapter]);
	}
	const queue: { version: number; path: A[] }[] = [{ version: from, path: [] }];
	const visited = new Set<number>([from]);
	let path: A[] | undefined;
	for (let index = 0; index < queue.length; index++) {
		const current = queue[index];
		if (current.version === to) {
			path = current.path;
			break;
		}
		for (const edge of [...(edges.get(current.version) ?? [])].sort((a, b) =>
			a.id.localeCompare(b.id),
		)) {
			if (!visited.has(edge.to)) {
				visited.add(edge.to);
				queue.push({ version: edge.to, path: [...current.path, edge] });
			}
		}
	}
	if (!path)
		throw new ApiVersionError(
			`No supported conversion from API v${from} to v${to}`,
		);
	return path;
}

export function convertApiVersion<T>(
	payload: T,
	from: number,
	to: number,
	adapters: readonly ApiVersionAdapter<T>[],
): ApiVersionConversion<T> {
	const path = apiVersionPath(from, to, adapters);
	let converted = structuredClone(payload);
	const steps: ApiVersionConversion<T>["steps"] = [];
	for (const adapter of path) {
		try {
			converted = adapter.convert(structuredClone(converted));
		} catch (error) {
			throw new ApiVersionError(
				`API adapter ${adapter.id} failed: ${error instanceof Error ? error.message : "unsupported payload"}`,
				error,
			);
		}
		steps.push({ from: adapter.from, to: adapter.to, id: adapter.id });
	}
	return { from, to, payload: converted, steps };
}

/** Same transitive graph, with adapters that can resolve authoritative API
 * metadata inside the caller's transaction. No PR or approval policy lives here. */
export async function convertApiVersionAsync<T>(
	payload: T,
	from: number,
	to: number,
	adapters: readonly AsyncApiVersionAdapter<T>[],
): Promise<ApiVersionConversion<T>> {
	const path = apiVersionPath(from, to, adapters);
	let converted = structuredClone(payload);
	const steps: ApiVersionConversion<T>["steps"] = [];
	for (const adapter of path) {
		try {
			converted = await adapter.convert(structuredClone(converted));
		} catch (error) {
			throw new ApiVersionError(
				`API adapter ${adapter.id} failed: ${error instanceof Error ? error.message : "unsupported payload"}`,
				error,
			);
		}
		steps.push({ from: adapter.from, to: adapter.to, id: adapter.id });
	}
	return { from, to, payload: converted, steps };
}
