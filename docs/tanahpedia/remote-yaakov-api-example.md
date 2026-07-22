# Tanahpedia Remote API Example: Create יעקב by API

This document is a runnable example guide.

Canonical behavior and contracts are defined in other docs. If anything here conflicts with those documents, the canonical docs win.

## Canonical docs (source of truth)

- Revision API contract and auth: [external-revision-api.md](./external-revision-api.md)
- Tanahpedia API/admin implementation roadmap: [implementation-plan.md](./implementation-plan.md)
- Admin Cognito callback/login domains: [../aws/cloudformation/cognito-admin.yaml](../aws/cloudformation/cognito-admin.yaml)

## What is available today

- Supported remotely in production GraphQL API:
  - `submitEntryRevision`
  - `applyEntryRevision`
  - `tanahpediaFindPersons` (read-only, find a `PERSON` entity by exact display name)
  - `tanahpediaFindEntities` (read-only, find any entity type by exact display name)
  - `tanahpediaEntityTanahSources` (read-only, an entity's own direct Tanah citations)
  - `tanahpediaPersonUnions` (read-only, list a person's union links with the other party
    resolved and the `sourceCitation` needed to review/correct a link)
  - `tanahpediaPersonParentChild` (read-only, list a person's parent/child links with the
    other party resolved and the `sourceCitation` needed to review/correct a link)
  - `tanahpediaPersonDetails` (read-only, a person's full name/sex/birth/death/citation detail)
- Not exposed remotely in `web/api` yet:
  - `createFamilyPersonNode`
  - `createParentChildLink`
  - `createUnionLink`
  - `updateUnionLink` (and the rest of the family graph CRUD)

The family graph mutations above currently live in the admin app flow and are not documented as public Rust GraphQL mutations in the canonical API docs yet. Deeply-typed reads for
non-person entity domains (place coordinates, event date ranges, war participants, etc.) are
also not yet exposed — see [external-revision-api.md](./external-revision-api.md) for the
current scope of the family-graph read queries.

## Endpoint and auth

- Endpoint: `https://api.xn--febl3a.com/`
- Header required: `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>`
- The revision API is fail-closed when the key is missing or invalid.

Reference: [external-revision-api.md](./external-revision-api.md)

## Example 1: create a new יעקב entry remotely (curl)

### 1) Submit a new entry revision

```bash
cat > /tmp/submit_yaakov_revision.json <<'EOF'
{
  "query": "mutation Submit($input: SubmitEntryRevisionInput!) { submitEntryRevision(input: $input) { id status createdAt } }",
  "variables": {
	"input": {
	  "proposedUniqueName": "יעקב_ניסוי_אפי_מרחוק",
	  "proposedTitle": "יעקב - ניסוי API מרחוק",
	  "proposedContent": "<p>ערך יעקב שנוצר דרך Remote API.</p>",
	  "source": "remote-client-example",
	  "notes": "create entry remotely via revision flow"
	}
  }
}
EOF

curl -sS -X POST "https://api.xn--febl3a.com/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TANAHPEDIA_REVISION_API_KEY}" \
  --data-binary @/tmp/submit_yaakov_revision.json
```

Expected: JSON containing revision `id` with `status: PENDING`.

### 2) Apply the revision

Replace `<REVISION_ID>` with the `id` returned by step 1.

```bash
cat > /tmp/apply_yaakov_revision.json <<'EOF'
{
  "query": "mutation Apply($id: String!) { applyEntryRevision(id: $id) { id entryId status updatedAt } }",
  "variables": {
	"id": "<REVISION_ID>"
  }
}
EOF

curl -sS -X POST "https://api.xn--febl3a.com/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TANAHPEDIA_REVISION_API_KEY}" \
  --data-binary @/tmp/apply_yaakov_revision.json
```

Expected: JSON containing `status: APPLIED` and the created/updated `entryId`.

## Example 2: Rust client (reqwest + serde)

There is no dedicated Rust client package in this repo for Tanahpedia revisions yet.
Use `reqwest` directly as shown below.

```rust
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct GraphQLRequest<T> {
	query: &'static str,
	variables: T,
}

#[derive(Serialize)]
struct SubmitVars {
	input: SubmitInput,
}

#[derive(Serialize)]
struct SubmitInput {
	#[serde(rename = "proposedUniqueName")]
	proposed_unique_name: String,
	#[serde(rename = "proposedTitle")]
	proposed_title: String,
	#[serde(rename = "proposedContent")]
	proposed_content: String,
	source: String,
	notes: String,
}

#[derive(Serialize)]
struct ApplyVars {
	id: String,
}

#[derive(Deserialize)]
struct GraphQLError {
	message: String,
}

#[derive(Deserialize)]
struct SubmitData {
	#[serde(rename = "submitEntryRevision")]
	submit_entry_revision: RevisionRow,
}

#[derive(Deserialize)]
struct ApplyData {
	#[serde(rename = "applyEntryRevision")]
	apply_entry_revision: AppliedRow,
}

#[derive(Deserialize)]
struct RevisionRow {
	id: String,
	status: String,
	#[serde(rename = "createdAt")]
	created_at: String,
}

#[derive(Deserialize)]
struct AppliedRow {
	id: String,
	#[serde(rename = "entryId")]
	entry_id: String,
	status: String,
	#[serde(rename = "updatedAt")]
	updated_at: String,
}

#[derive(Deserialize)]
struct GraphQLResponse<T> {
	data: Option<T>,
	errors: Option<Vec<GraphQLError>>,
}

const SUBMIT_QUERY: &str = "mutation Submit($input: SubmitEntryRevisionInput!) { submitEntryRevision(input: $input) { id status createdAt } }";
const APPLY_QUERY: &str = "mutation Apply($id: String!) { applyEntryRevision(id: $id) { id entryId status updatedAt } }";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let endpoint = "https://api.xn--febl3a.com/";
	let api_key = std::env::var("TANAHPEDIA_REVISION_API_KEY")?;
	let client = Client::new();

	let submit_payload = GraphQLRequest {
		query: SUBMIT_QUERY,
		variables: SubmitVars {
			input: SubmitInput {
				proposed_unique_name: "יעקב_ניסוי_אפי_מרחוק".to_string(),
				proposed_title: "יעקב - ניסוי API מרחוק".to_string(),
				proposed_content: "<p>ערך יעקב שנוצר דרך Remote API.</p>".to_string(),
				source: "rust-remote-client".to_string(),
				notes: "create by external rust client".to_string(),
			},
		},
	};

	let submit_res: GraphQLResponse<SubmitData> = client
		.post(endpoint)
		.bearer_auth(&api_key)
		.json(&submit_payload)
		.send()
		.await?
		.json()
		.await?;

	if let Some(errors) = submit_res.errors {
		anyhow::bail!("submit failed: {}", errors[0].message);
	}
	let revision_id = submit_res
		.data
		.expect("submit data missing")
		.submit_entry_revision
		.id;

	let apply_payload = GraphQLRequest {
		query: APPLY_QUERY,
		variables: ApplyVars { id: revision_id },
	};

	let apply_res: GraphQLResponse<ApplyData> = client
		.post(endpoint)
		.bearer_auth(&api_key)
		.json(&apply_payload)
		.send()
		.await?
		.json()
		.await?;

	if let Some(errors) = apply_res.errors {
		anyhow::bail!("apply failed: {}", errors[0].message);
	}

	let applied = apply_res
		.data
		.expect("apply data missing")
		.apply_entry_revision;
	println!("Applied revision {} to entry {}", applied.id, applied.entry_id);
	Ok(())
}
```

## Current limitation and next API step

If the goal is full family graph creation for יעקב (people, parent-child links, unions) via remote Rust GraphQL API, add dedicated mutations under `web/api` that mirror:

- `createFamilyPersonNode`
- `createParentChildLink`
- `createUnionLink`

Until then, remote external clients can create/update entries through the revision API, while family graph mutation remains in admin server-function endpoints.

Roadmap reference: [implementation-plan.md](./implementation-plan.md)
