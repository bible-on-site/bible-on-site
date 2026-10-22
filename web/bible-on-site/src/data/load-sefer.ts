import type { Perek, SefarimItem } from "./db/tanah-view-types";

export class BookRequestError extends Error {
	constructor(readonly status: number) {
		super(`Book request failed: ${status}`);
		this.name = "BookRequestError";
	}
}

// Keep a few recent books, rather than reconstructing the complete corpus in memory.
const cache = new Map<string, Promise<SefarimItem>>();
const MAX_CACHED_BOOKS = 4;

/** Map every perekId in a loaded sefer JSON to its Perek. */
export function seferPerekMap(sefer: SefarimItem): Map<number, Perek> {
	const map = new Map<number, Perek>();
	if ("perakim" in sefer) {
		sefer.perakim.forEach((perek, idx) => {
			map.set(sefer.perekFrom + idx, perek);
		});
		return map;
	}
	for (const additional of sefer.additionals) {
		additional.perakim.forEach((perek, idx) => {
			map.set(additional.perekFrom + idx, perek);
		});
	}
	return map;
}

export function loadSefer(file: string): Promise<SefarimItem> {
	const existing = cache.get(file);
	if (existing) {
		cache.delete(file);
		cache.set(file, existing);
		return existing;
	}
	const request: Promise<SefarimItem> = Promise.resolve()
		.then(async () => {
			const response = await fetch(file, { cache: "no-cache" });
			if (!response.ok)
				throw new BookRequestError(response.status);
			return (await response.json()) as SefarimItem;
		})
		.catch((error) => {
			if (cache.get(file) === request) cache.delete(file);
			throw error;
		});
	cache.set(file, request);
	while (cache.size > MAX_CACHED_BOOKS) {
		for (const oldest of cache.keys()) {
			cache.delete(oldest);
			break;
		}
	}
	return request;
}
