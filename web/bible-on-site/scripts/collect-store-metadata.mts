/**
 * Collect a store-metadata snapshot at build time (#2395).
 *
 * Written to src/data/db/store-metadata-snapshot.generated.json (gitignored,
 * like client-catalog.generated.json). The runtime seeds its per-platform
 * last-good observations from this file so a cold process serves real data
 * instead of starting empty — the badge pipeline's availability then depends
 * on the build image, not on a first-request scrape succeeding.
 *
 * Modes:
 *   (default)   fetch each store once and write whatever succeeded
 *   --ensure    only create an empty snapshot when the file is missing
 *               (postinstall: keep tsc/jest working without network)
 *
 * A store that fails during the build is omitted from the snapshot rather
 * than failing the build: the feature degrades to the no-seed behaviour.
 */
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	collectStoreMetadata,
	STORE_METADATA_SOURCES,
	type StorePlatform,
} from "../src/lib/store-metadata/collect";

const OUTPUT = fileURLToPath(
	new URL(
		"../src/data/db/store-metadata-snapshot.generated.json",
		import.meta.url,
	),
);

if (process.argv.includes("--ensure")) {
	if (!existsSync(OUTPUT)) {
		writeFileSync(OUTPUT, "{}\n");
		console.log("Wrote empty store-metadata snapshot (ensure mode).");
	}
} else {
	const snapshot: Record<string, unknown> = {};
	for (const platform of Object.keys(
		STORE_METADATA_SOURCES,
	) as StorePlatform[]) {
		try {
			snapshot[platform] = await collectStoreMetadata(platform);
		} catch (error) {
			console.warn(
				`store-metadata snapshot: ${platform} fetch failed, seeding without it`,
				error,
			);
		}
	}
	writeFileSync(OUTPUT, `${JSON.stringify(snapshot)}\n`);
	console.log(
		`Wrote store-metadata snapshot for: ${Object.keys(snapshot).join(", ") || "(none)"}`,
	);
}
