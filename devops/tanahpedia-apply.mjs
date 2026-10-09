/**
 * Applies a Tanahpedia operation set (entries + family graph) through the
 * authenticated GraphQL API. Formalizes the local-first / prod-replay flow:
 * the same JSON file is applied locally, reviewed, then replayed on prod.
 *
 * Usage:
 *   TANAHPEDIA_REVISION_API_KEY=... npm run tanahpedia:apply -- <ops.json> [--endpoint <url>]
 *
 * File shape:
 * {
 *   "endpoint": "http://127.0.0.1:3003/",        // overridable via --endpoint
 *   "entries": [{ "uniqueName", "title", "content", "entityId", "linkId" }],
 *   "personNodes": [PutTanahpediaPersonNodeInput],
 *   "entryEntityLinks": [PutTanahpediaEntryEntityLinkInput],
 *   "parentChildLinks": [PutTanahpediaParentChildInput],
 *   "unions": [PutTanahpediaPersonUnionInput]
 * }
 * All puts use caller-supplied stable IDs, so re-running is idempotent.
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const fileArg = args.find((a) => !a.startsWith("--"));
const endpointFlagIdx = args.indexOf("--endpoint");
if (!fileArg) {
	console.error("Usage: tanahpedia:apply -- <ops.json> [--endpoint <url>]");
	process.exit(1);
}
const apiKey = process.env.TANAHPEDIA_REVISION_API_KEY;
if (!apiKey) {
	console.error("TANAHPEDIA_REVISION_API_KEY is required");
	process.exit(1);
}

const ops = JSON.parse(fs.readFileSync(fileArg, "utf8"));
const endpoint =
	(endpointFlagIdx !== -1 ? args[endpointFlagIdx + 1] : undefined) ??
	ops.endpoint ??
	"http://127.0.0.1:3003/";

async function graphql(query, variables = {}, { allowErrors = false } = {}) {
	const res = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ query, variables }),
	});
	const payload = await res.json();
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(payload)}`);
	if (!allowErrors && payload.errors?.length) {
		throw new Error(payload.errors.map((e) => e.message).join("\n"));
	}
	return payload;
}

const M = {
	putPerson: `mutation($input: PutTanahpediaPersonNodeInput!) { putTanahpediaPersonNode(input: $input) { entityId personId sexId } }`,
	putLink: `mutation($input: PutTanahpediaEntryEntityLinkInput!) { putTanahpediaEntryEntityLink(input: $input) { id entryId entityId } }`,
	submit: `mutation($input: SubmitEntryRevisionInput!) { submitEntryRevision(input: $input) { id } }`,
	apply: `mutation($id: String!) { applyEntryRevision(id: $id) { id entryId status } }`,
	putParentChild: `mutation($input: PutTanahpediaParentChildInput!) { putTanahpediaParentChildLink(input: $input) { id } }`,
	putUnion: `mutation($input: PutTanahpediaPersonUnionInput!) { putTanahpediaPersonUnion(input: $input) { id } }`,
};

/** Entry ensure: link if the entry exists, otherwise submit+apply then link. */
async function ensureEntry(entry) {
	const linkInput = {
		id: entry.linkId,
		entryUniqueName: entry.uniqueName,
		entityId: entry.entityId,
	};
	const attempt = await graphql(M.putLink, { input: linkInput }, { allowErrors: true });
	let entryId = attempt.data?.putTanahpediaEntryEntityLink?.entryId;
	if (entryId) return { uniqueName: entry.uniqueName, entryId, op: "existing" };
	const messages = attempt.errors?.map((e) => e.message) ?? [];
	if (!messages.some((m) => /not found|does not reference an existing entry/i.test(m))) {
		throw new Error(`${entry.uniqueName}: ${messages.join("; ")}`);
	}
	const submitted = await graphql(M.submit, {
		input: {
			proposedUniqueName: entry.uniqueName,
			proposedTitle: entry.title,
			proposedContent: entry.content ?? "<p></p>",
			source: "tanahpedia-apply-script",
			notes: entry.notes ?? "Applied via tanahpedia:apply operation set",
		},
	});
	const applied = await graphql(M.apply, { id: submitted.data.submitEntryRevision.id });
	entryId = applied.data.applyEntryRevision.entryId;
	await graphql(M.putLink, { input: linkInput });
	return { uniqueName: entry.uniqueName, entryId, op: "created" };
}

const results = { endpoint, entries: [], personNodes: [], entryEntityLinks: [], parentChildLinks: [], unions: [] };
for (const p of ops.personNodes ?? []) {
	results.personNodes.push((await graphql(M.putPerson, { input: p })).data.putTanahpediaPersonNode);
}
for (const e of ops.entries ?? []) {
	results.entries.push(await ensureEntry(e));
}
for (const l of ops.entryEntityLinks ?? []) {
	results.entryEntityLinks.push((await graphql(M.putLink, { input: l })).data.putTanahpediaEntryEntityLink);
}
for (const pc of ops.parentChildLinks ?? []) {
	results.parentChildLinks.push((await graphql(M.putParentChild, { input: pc })).data.putTanahpediaParentChildLink);
}
for (const u of ops.unions ?? []) {
	results.unions.push((await graphql(M.putUnion, { input: u })).data.putTanahpediaPersonUnion);
}
console.log(JSON.stringify(results, null, 1));
