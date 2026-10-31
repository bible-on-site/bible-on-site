import { validateRecoveryProof } from "./recovery-request.mjs";

const markerPrefix = "<!-- release-delivery:";
const markerSuffix = " -->";

/** Published releases replay their original artifact and CI attempt. */
export function releasePayload(release) {
	const body = release.body ?? "";
	const finalLine = body.trimEnd().split(/\r?\n/).at(-1).trim();
	if (
		!finalLine.startsWith(markerPrefix) ||
		!finalLine.endsWith(markerSuffix)
	) {
		if (body.includes(markerPrefix))
			throw new Error(
				"Release delivery metadata must be the publisher's final standalone marker",
			);
		return undefined;
	}
	const payload = JSON.parse(
		finalLine.slice(markerPrefix.length, -markerSuffix.length),
	);
	if (
		!/^[a-f0-9]{40}$/.test(payload.ref) ||
		!/^\d+$/.test(String(payload.ci_run_id)) ||
		(payload.ci_run_attempt !== undefined &&
			!/^([1-9]\d*)$/.test(String(payload.ci_run_attempt))) ||
		release.tag_name !== `${payload.module_name}-v${payload.module_version}`
	) {
		throw new Error("Release delivery metadata does not match its tag/source");
	}
	if (payload.recovery !== undefined)
		validateRecoveryProof(payload.recovery, payload.module_name);
	return payload;
}

/** Bind both API platform artifacts to the CI run recorded in the published release. */
export function apiImageArtifacts(payload) {
	if (payload?.released_arm64_artifact_name === undefined) return undefined;
	const amd64 = `bible-on-site-api-docker-${payload.ci_run_id}`;
	const arm64 = `${amd64}-arm64`;
	if (
		payload.module_name !== "api" ||
		!/^\d+$/.test(String(payload.ci_run_id)) ||
		payload.released_artifact_name !== amd64 ||
		payload.released_arm64_artifact_name !== arm64
	) {
		throw new Error(
			"API platform artifacts do not match published CI provenance",
		);
	}
	return { amd64, arm64 };
}
