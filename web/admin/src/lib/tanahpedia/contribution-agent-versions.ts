const PREFIX = "tanahpedia-agents-v";

/** Release identifiers use bounded ASCII integers, independently of API data versions. */
function components(value: string): [number, number, number] {
	if (
		typeof value !== "string" ||
		value.length > 64 ||
		!value.startsWith(PREFIX)
	)
		throw new Error("Invalid contribution agent release version");
	const parts = value.slice(PREFIX.length).split(".");
	if (parts.length > 3)
		throw new Error("Invalid contribution agent release version");
	const numbers = parts.map((part) => {
		if (!part.length || part.length > 9 || (part.length > 1 && part[0] === "0"))
			throw new Error("Invalid contribution agent release component");
		let number = 0;
		for (let index = 0; index < part.length; index++) {
			const code = part.charCodeAt(index);
			if (code < 48 || code > 57)
				throw new Error("Invalid contribution agent release component");
			number = number * 10 + code - 48;
		}
		return number;
	});
	return [numbers[0], numbers[1] ?? 0, numbers[2] ?? 0];
}

export function compareContributionAgentVersions(
	left: string,
	right: string,
): -1 | 0 | 1 {
	const first = components(left),
		second = components(right);
	for (let index = 0; index < first.length; index++) {
		if (first[index] < second[index]) return -1;
		if (first[index] > second[index]) return 1;
	}
	return 0;
}

function validHash(value: string) {
	if (typeof value !== "string" || value.length !== 64)
		throw new Error("Invalid contribution agent bundle hash");
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (!(code >= 48 && code <= 57) && !(code >= 97 && code <= 102))
			throw new Error("Invalid contribution agent bundle hash");
	}
}

/** Never move an installed declaration backward. A changed release must have
 * a new version; reusing its version for different bytes fails closed. */
export function contributionAgentBundleUpgrade(
	installed: { version: string; hash: string },
	available: { version: string; hash: string },
): "keep" | "noop" | "upgrade" {
	const compared = compareContributionAgentVersions(
		installed.version,
		available.version,
	);
	validHash(installed.hash);
	validHash(available.hash);
	if (installed.hash === available.hash) return "noop";
	if (compared > 0) return "keep";
	if (compared === 0)
		throw new Error(
			"Contribution agent release version was reused for a different bundle",
		);
	return "upgrade";
}
