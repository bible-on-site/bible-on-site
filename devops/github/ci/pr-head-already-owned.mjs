import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function headAlreadyOwned(pullRequests, head) {
	if (!/^[a-f0-9]{40}$/.test(head ?? "") || !Array.isArray(pullRequests)) {
		throw new Error("Invalid PR ownership inputs");
	}
	for (const pr of pullRequests) {
		if (
			!pr ||
			!["OPEN", "MERGED", "CLOSED"].includes(pr.state) ||
			!/^[a-f0-9]{40}$/.test(pr.headRefOid ?? "")
		) {
			throw new Error("Invalid PR ownership response");
		}
	}
	if (pullRequests.some((pr) => pr.state === "OPEN" || pr.headRefOid === head))
		return 1;
	if (pullRequests.length >= 100)
		throw new Error("Incomplete PR ownership history");
	return 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	console.log(
		headAlreadyOwned(JSON.parse(readFileSync(0, "utf8")), process.argv[2]),
	);
}
