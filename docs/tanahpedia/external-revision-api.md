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

## Query — family graph lookups (find persons / list unions / list parent-child links / person details)

Read-only queries that let an authorized client discover the internal ids needed to review
or correct family-graph data (e.g. a union's `sourceCitation`) without direct DB access.
**Authorized only** — same bearer token as the mutations above.

```graphql
query FindPersons($name: String!) {
  tanahpediaFindPersons(name: $name) {
    entityId
    personId
    displayName
  }
}
```

Returns every `PERSON` entity whose display name exactly matches `name` (Torah names are
frequently shared, so more than one match is possible — disambiguate using `entityId`).

```graphql
query FindEntities($name: String!, $entityType: String) {
  tanahpediaFindEntities(name: $name, entityType: $entityType) {
    entityId
    entityType
    displayName
  }
}
```

Returns every Tanahpedia entity of any type (`PERSON`, `PLACE`, `EVENT`, `WAR`, `ANIMAL`,
`OBJECT`, `TEMPLE_TOOL`, `PLANT`, `ASTRONOMICAL_OBJECT`, `SAYING`, `SEFER`, `PROPHECY`,
`NATION`) whose display name exactly matches `name`. Pass `entityType` to narrow to a single
type; omit it to search across every type.

```graphql
query EntityTanahSources($entityId: String!) {
  tanahpediaEntityTanahSources(entityId: $entityId) {
    perekId
    pasukNumber
    segmentStart
    segmentEnd
    citation
  }
}
```

Lists the direct Tanah citations (perek + pasuk) attached to an entity itself — this is the
"source for the entity itself" (e.g. the pasuk that first names a person), distinct from a
specific relationship's free-text `sourceCitation`. `citation` is a formatted Hebrew string
(e.g. `"בראשית ל' ד'"`); `perekId`/`pasukNumber` are the raw values for callers that want to
format the citation themselves.

```graphql
query PersonUnions($personId: String!) {
  tanahpediaPersonUnions(personId: $personId) {
    id
    unionType
    unionOrder
    sourceCitation
    person1Id
    person2Id
    otherPersonId
    otherDisplayName
  }
}
```

Lists every union (marriage/pilegesh/betrothal/etc.) row involving `personId`, resolving the
other party's id and display name so the union can be identified without a direct join.

```graphql
query PersonParentChild($personId: String!) {
  tanahpediaPersonParentChild(personId: $personId) {
    id
    relationshipType
    parentRole
    sourceCitation
    parentId
    childId
    otherPersonId
    otherDisplayName
    queriedIsParent
  }
}
```

Lists every parent/child row involving `personId` on either side. `queriedIsParent` tells the
caller whether `personId` is the parent (`true`) or the child (`false`) in that row.

```graphql
query PersonDetails($personId: String!) {
  tanahpediaPersonDetails(personId: $personId) {
    entityId
    personId
    displayName
    names {
      id
      name
      nameType
      altGroupId
    }
    sexes
    birthDates
    deathDates
    deathCauses
    birthPlaceIds
    tanahSources {
      perekId
      pasukNumber
      citation
    }
  }
}
```

Returns the full reviewable detail for a person in one call: every name (with resolved
name type), sex, birth/death date, death cause, birth place id, and entity-level Tanah
citation. Each list field can have more than one entry because the schema allows multiple
alternate-opinion rows per person (`altGroupId`). Errors with `NOT_FOUND` when the person (or
its linked entity) doesn't exist.

These queries only read `tanahpedia_entity`, `tanahpedia_person`, `tanahpedia_person_name`,
`tanahpedia_person_sex`, `tanahpedia_person_birth_date`, `tanahpedia_person_death_date`,
`tanahpedia_person_death_cause`, `tanahpedia_person_birth_place`, `tanahpedia_person_union`,
`tanahpedia_person_parent_child`, `tanahpedia_entity_tanah_source`, and their `lookup_*`
tables — they do not expose or modify any other table. Deeply-typed reads for non-person
entity domains (e.g. a place's coordinates, an event's date range, a war's participants) are
not yet exposed; only the generic entity + entity-level-citation queries above cover those
domains today.

## Storage


Table `tanahpedia_entry_revision` (see [tanachpedia.dbml](./tanachpedia.dbml)) — a staging
area decoupled from `tanahpedia_entry`. `entry_id` is nullable (new-entry proposals) with
`ON DELETE CASCADE`, and `status` defaults to `PENDING`.

## Server environment

| Variable                     | Description                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `TANAHPEDIA_REVISION_API_KEY`| Bearer token external AI clients must present. Endpoint fails closed when unset. |

Set it in the API environment (`.env` / ECS task definition). Never expose it client-side.
