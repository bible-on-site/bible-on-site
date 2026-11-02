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
| `baseRevisionId`     | `String` | The APPLIED head revision this proposal was authored against.           |

Validation (server-side):

- `source` must be non-blank.
- At least one of `proposedUniqueName` / `proposedTitle` / `proposedContent` must be present.
- When `entryId` is supplied it must reference an existing entry, otherwise `NOT_FOUND`.
- When `baseRevisionId` is supplied it must reference a revision of the same entry,
  otherwise `BAD_REQUEST`. It may only be set when `entryId` is set.

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
- When the revision declares `baseRevisionId`, applying while the entry's APPLIED head has
  moved elsewhere is rejected (`BAD_REQUEST`, stale base) — fetch the current head and
  re-submit the proposal to retry. On a successful apply the revision's stored
  `baseRevisionId` is stamped with the head it displaced.

## Wiki-style history

Every applied change — admin save, LLM-assistant apply, or an applied external revision —
is an immutable `APPLIED` full-snapshot row. The entry's latest `APPLIED` revision is its
head; the admin editor sends it as the save's base so concurrent editors are rejected
rather than silently overwriting, and restores are themselves new `APPLIED` revisions.

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
    startDate
    endDate
    endReason
    altGroupId
    sourceCitation
    personSourceCitation
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
    altGroupId
    sourceCitation
    birthOrder
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

## Mutations — person-node and family relationship writes

Authorized clients can idempotently create or replace relationship rows after resolving the
person ids with `tanahpediaFindPersons`. Replaying a `put` mutation with the same relationship
`id` updates that row instead of creating a duplicate.

```graphql
mutation PutEntryEntityLink($input: PutTanahpediaEntryEntityLinkInput!) {
  putTanahpediaEntryEntityLink(input: $input) {
    id
    entryId
    entityId
  }
}

mutation PutPersonNode($input: PutTanahpediaPersonNodeInput!) {
  putTanahpediaPersonNode(input: $input) {
    entityId
    personId
    sexId
  }
}
```

`PutTanahpediaEntryEntityLinkInput` requires a caller-supplied stable `id`, the existing
entry's `entryUniqueName`, and an existing `entityId`. It creates the association the website
uses to discover an entry's typed root entity. Exact replay performs no write. The mutation
rejects a link id owned by another pair and rejects a pair already owned by another link id.

`PutTanahpediaPersonNodeInput` requires caller-supplied stable `entityId`, `personId`, and
`sexId` values plus `displayName` and `sex` (`MALE`, `FEMALE`, or `UNKNOWN`). It optionally
accepts `sexAltGroupId`. The mutation atomically upserts the `PERSON` entity, typed person row,
and sex row. Replaying the same input is idempotent. It rejects an id that already belongs to a
different entity type/person binding instead of reassigning existing data. This is a full put:
omitting `sexAltGroupId` clears an existing value. An unchanged replay does not refresh the
entity's `updatedAt` timestamp.

Cleanup is intentionally split into narrow, reviewable stages. Removing a duplicate person
attachment does not silently delete its entity:

```graphql
mutation DeleteOrphanPersonNode($input: DeleteTanahpediaPersonNodeInput!) {
  deleteTanahpediaOrphanPersonNode(input: $input) {
    entityId
    personId
    sexId
  }
}

mutation DeleteOrphanEntity($input: DeleteTanahpediaOrphanEntityInput!) {
  deleteTanahpediaOrphanEntity(input: $input) {
    entityId
    entityType
    displayName
  }
}
```

`DeleteTanahpediaPersonNodeInput` requires the exact `entityId`, `personId`, and `sexId`.
The mutation locks those rows and rejects deletion while the person has any entry link,
relationship, name, role, date, place, citation, or other person metadata. The entity remains
and therefore appears as `(אין ערך)` in a public category index until separately removed.

`DeleteTanahpediaOrphanEntityInput` requires the exact `entityId`, `entityType`, and
`displayName`. The mutation locks and rechecks that identity, then rejects deletion while any
table with a direct foreign key to `tanahpedia_entity` still references it. Use this second
mutation only when preserving the unlinked entity is not intended.

```graphql
mutation PutParentChild($input: PutTanahpediaParentChildInput!) {
  putTanahpediaParentChildLink(input: $input) { id }
}

mutation PutUnion($input: PutTanahpediaPersonUnionInput!) {
  putTanahpediaPersonUnion(input: $input) { id }
}

mutation DeleteParentChild($id: String!) {
  deleteTanahpediaParentChildLink(id: $id) { id }
}

mutation DeleteUnion($id: String!) {
  deleteTanahpediaPersonUnion(id: $id) { id }
}
```

`PutTanahpediaParentChildInput` requires `id`, `parentPersonId`, `childPersonId`,
`relationshipType`, and `parentRole`; it optionally accepts `altGroupId` and
`sourceCitation` and a positive, one-based `birthOrder`. The order is stored on each
parent-child link; omit it when the order is unknown. As with other optional put fields,
omission clears a previously stored order. `PutTanahpediaPersonUnionInput` requires `id`, `person1Id`, `person2Id`,
and `unionType`; it optionally accepts `unionOrder`, `startDate`, `endDate`, `endReason`,
`altGroupId`, `sourceCitation`, and `personSourceCitation`.

Lookup names are case-insensitive. Current parent-child types are `BIOLOGICAL`, `ADOPTIVE`,
`STEP`, and `FOSTER`; parent roles are `FATHER` and `MOTHER`; union types are `MARRIAGE`,
`PILEGESH`, `FORBIDDEN_WITH_GENTILE`, `BANNED_INCEST`, and `BETROTHAL`; end reasons are
`DEATH` and `DIVORCE`. Citations are limited to 400 characters. People on both sides must
exist and must be distinct. Deletes return `NOT_FOUND` when the relationship id does not exist.

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
    sexRows {
      id
      sex
      altGroupId
    }
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
citation. `sexes` remains the compact value list; `sexRows` is the lossless form containing
the stable row id and `altGroupId` needed for read-after-write comparison. Each list field can
have more than one entry because the schema allows multiple alternate-opinion rows per person
(`altGroupId`). Errors with `NOT_FOUND` when the person (or its linked entity) doesn't exist.

These queries only read `tanahpedia_entity`, `tanahpedia_person`, `tanahpedia_person_name`,
`tanahpedia_person_sex`, `tanahpedia_person_birth_date`, `tanahpedia_person_death_date`,
`tanahpedia_person_death_cause`, `tanahpedia_person_birth_place`, `tanahpedia_person_union`,
`tanahpedia_person_parent_child`, `tanahpedia_entity_tanah_source`, and their `lookup_*`
tables — they do not expose or modify any other table. Deeply-typed reads for non-person
entity domains (e.g. a place's coordinates, an event's date range, a war's participants) are
not yet exposed; only the generic entity + entity-level-citation queries above cover those
domains today.

## Queries & mutations — entry secondary URLs (aliases)

A secondary URL ("alias") is an extra name that lands on an entry: one alias row redirects
to a single entry, two or more rows with labels make the name a shared disambiguation page.
These operations mirror the admin editor's alias save/remove/delete flows, including the
name lock, the canonical-name and reserved-route collision checks, and the stale-baseline
conflict guard.

```graphql
query NameStatus($name: String!, $forEntryId: ID) {
  tanahpediaNameStatus(name: $name, forEntryId: $forEntryId) {
    kind        # invalid | reserved | canonical | self_main | alias | free
    name
    canonicalEntry { id uniqueName title }
    reservedCategory
    aliasTargets { entryId uniqueName title label }
  }
}

query EntryAliases($entryId: String!) {
  tanahpediaEntryAliases(entryId: $entryId) {
    name
    kind        # alias | disambiguation
    targets { entryId uniqueName title label }
    isSelfMain  # this entry owns the canonical name — editor skips it
    reservedCategory
    shadowedByCanonical { id uniqueName title }  # another entry holds this name canonically
  }
}

mutation SaveAlias($input: SaveTanahpediaAliasInput!) {
  saveTanahpediaAlias(input: $input) {
    name
    kind        # alias (single target) | disambiguation (labeled multi-target)
    targetCount
    revalidation  # APPLIED | FAILED | SKIPPED — see below
  }
}

mutation RemoveFromAlias($name: String!, $entryId: String!) {
  removeTanahpediaEntryFromAlias(name: $name, entryId: $entryId) {
    name
    kind
    targetCount  # targets left on the name; 0 when the name was freed
    revalidation
  }
}

mutation DeleteAlias($name: String!) {
  deleteTanahpediaAlias(name: $name) {
    name
    kind
    targetCount
    revalidation
  }
}
```

`SaveTanahpediaAliasInput`: `name` (the secondary URL), `targets` (1+ `{ entryId, label? }`,
labels required on every target when the name is shared), and `expectedTargets` — the
target `entryId`s the caller saw when the edit began. If the live set differs the mutation
fails with a stale-baseline conflict (the same guard the admin editor applies), so a client
never silently overwrites another admin's change.

Name rules, ported verbatim from the admin validator: non-empty, no `/`, 255 chars max,
normalized like an entry name (trim → URI-decode → NFC); a shared name requires a
255-chars-max label on every target. The name must not collide with a category's reserved
route (Hebrew or English slug) nor with an entry's canonical name — changing a canonical
name goes through the entry itself, not the alias API.

Every write runs inside a transaction that takes a `FOR UPDATE` lock on the name's
`synonym` rows, commits, then asks the website to revalidate the alias name and every
affected entry. `revalidation` reports `APPLIED`, `FAILED` (committed — re-save to retry),
or `SKIPPED` (the revalidator is not configured); a `FAILED`/`SKIPPED` result never rolls
back the committed write. `removeTanahpediaEntryFromAlias` is the per-entry rollback path;
when one target remains it also drops the leftover disambiguation label so the name becomes
a plain redirect again.

## Storage


Table `tanahpedia_entry_revision` (see [tanachpedia.dbml](./tanachpedia.dbml)) — a staging
area decoupled from `tanahpedia_entry`. `entry_id` is nullable (new-entry proposals) with
`ON DELETE CASCADE`, and `status` defaults to `PENDING`.

Alias rows live in `tanahpedia_entry_synonym` (name → entry) and
`tanahpedia_entry_synonym_disambiguation` (per-target labels on shared names). These tables
are also written by the admin editor, so the API and the admin stay consistent.

## Server environment

| Variable                     | Description                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `TANAHPEDIA_REVISION_API_KEY`| Bearer token external AI clients must present. Endpoint fails closed when unset. |
| `WEBSITE_URL`                | Website base URL the alias writes POST `/api/revalidate` to after commit. Revalidation reports `SKIPPED` when unset. |
| `REVALIDATE_SECRET`          | Shared `x-revalidate-secret` header the website expects on revalidation calls. |

Set them in the API environment (`.env` / ECS task definition). Never expose them client-side.
