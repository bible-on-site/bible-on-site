# Tanahpedia External Revision API

API-first interface that lets an **external AI client** propose — and, when authorized,
apply — revisions to Tanahpedia entries. Submissions are stored as `PENDING` rows in
`tanahpedia_entry_revision` and are never applied as a side effect of submission. The same
authorized client (or a human in the Admin GUI) then applies a revision **explicitly**,
which updates the live `tanahpedia_entry` and marks the revision `APPLIED`. The revision
row is retained as the change's audit/history record.

## Endpoint

- **GraphQL:** `POST /` on the Bible-on-site API.
- **Auth:** every mutation requires
  `Authorization: Bearer <TANAHPEDIA_REVISION_API_KEY>`.
  The endpoint **fails closed** — if `TANAHPEDIA_REVISION_API_KEY` is unset/empty on the
  server, or the bearer token does not match (constant-time compare), the request is
  rejected with `UNAUTHORIZED`.

## Mutation — submit a revision

```graphql
mutation Submit($input: SubmitEntryRevisionInput!) {
  submitEntryRevision(input: $input) {
    id
    status      # always "PENDING" on creation
    createdAt
  }
}
```

`SubmitEntryRevisionInput`:

| Field                | Type     | Notes                                                                  |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `entryId`            | `String` | Existing entry to revise. **Omit** to propose a brand-new entry.       |
| `proposedUniqueName` | `String` | Proposed `unique_name`.                                                |
| `proposedTitle`      | `String` | Proposed title.                                                        |
| `proposedContent`    | `String` | Proposed entry body (HTML).                                            |
| `source`             | `String!`| **Required.** External AI client / model id (e.g. `"gpt-4o"`).         |
| `notes`              | `String` | AI rationale / notes for the human editor.                             |

Validation (server-side):

- `source` must be non-blank.
- At least one of `proposedUniqueName` / `proposedTitle` / `proposedContent` must be present.
- When `entryId` is supplied it must reference an existing entry, otherwise `NOT_FOUND`.

## Mutation — apply a revision

Applies a stored revision to the live entry. **Authorized only** (same bearer token as
submission — the whole API is for authorized clients, not the public).

```graphql
mutation Apply($id: String!) {
  applyEntryRevision(id: $id) {
    id
    entryId     # the live entry the change was applied to
    status      # "APPLIED"
    updatedAt
  }
}
```

- **Existing entry:** the revision's present `proposed*` fields overwrite that entry; absent
  fields are left untouched.
- **New entry** (`entryId` was null): a new entry is created — this requires both
  `proposedUniqueName` and `proposedTitle` (the entry's non-null columns) — and the revision
  is linked back to the new entry.
- Re-applying an already-`APPLIED` revision is rejected (`BAD_REQUEST`); a missing revision
  or a deleted target entry returns `NOT_FOUND`.

## Query — triage queue (Admin / internal)

```graphql
query Pending {
  tanahpediaEntryRevisions(status: "PENDING") {
    id
    entryId
    proposedTitle
    source
    notes
    createdAt
  }
}
```

Both `status` (`PENDING` / `APPLIED` / `APPROVED` / `REJECTED`) and `entryId` are optional filters;
results are returned newest-first.

## Storage

Table `tanahpedia_entry_revision` (see [tanachpedia.dbml](./tanachpedia.dbml)) — a staging
area decoupled from `tanahpedia_entry`. `entry_id` is nullable (new-entry proposals) with
`ON DELETE CASCADE`, and `status` defaults to `PENDING`.

## Server environment

| Variable                     | Description                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `TANAHPEDIA_REVISION_API_KEY`| Bearer token external AI clients must present. Endpoint fails closed when unset. |

Set it in the API environment (`.env` / ECS task definition). Never expose it client-side.
