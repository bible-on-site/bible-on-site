const marker = /<!-- release-delivery:(.*?) -->/;

/** Published releases replay their original artifact and CI attempt. */
export function releasePayload(release) {
	const match = release.body?.match(marker);
	if (!match) return undefined;
	const payload = JSON.parse(match[1]);
	if (
		!/^[a-f0-9]{40}$/.test(payload.ref) ||
		!/^\d+$/.test(String(payload.ci_run_id)) ||
		(payload.ci_run_attempt !== undefined &&
			!/^([1-9]\d*)$/.test(String(payload.ci_run_attempt))) ||
		release.tag_name !== `${payload.module_name}-v${payload.module_version}`
	) {
		throw new Error("Release delivery metadata does not match its tag/source");
	}
	return payload;
}
