# Tanahpedia External Revision API

API-first interface that lets an **external AI client** propose revisions to Tanahpedia
entries. Proposals are stored as `PENDING` rows in `tanahpedia_entry_revision` for human
triage in the Admin GUI and are **never auto-applied** to the live entry.

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

Both `status` (`PENDING` / `APPROVED` / `REJECTED`) and `entryId` are optional filters;
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
