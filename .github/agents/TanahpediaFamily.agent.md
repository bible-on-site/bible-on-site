---
description: "Tanahpedia family-tree data edits via the authenticated write API — person nodes, parent-child links and unions"
tools:
  [
    vscode,
    execute,
    read,
    edit,
    search,
    web,
    "io.github.bytebase/dbhub/*",
    "github/*",
    browser,
    gitkraken/git_add_or_commit,
    gitkraken/git_branch,
    gitkraken/git_checkout,
    gitkraken/git_log_or_diff,
    gitkraken/git_push,
    gitkraken/git_status,
    todo,
  ]
model: Claude Opus 5 (copilot)
---

# Tanahpedia Family Agent

Edits Tanahpedia family graphs (person nodes, parent-child links, unions) as **data changes**.
Never a schema change: if a field does not exist yet, stop and escalate — do not invent columns.

## Hard rules

- **All content writes go through the authenticated GraphQL write API.** Never `INSERT`/`UPDATE`/`DELETE`
  Tanahpedia content with SQL, seed scripts, `db-populator`, or Admin server functions.
  SQL is **read-only reconnaissance**.
- **Never author entry prose.** New entries carry the `<p></p>` placeholder plus metadata only
  (title, unique name, entry-entity link, person nodes, relationships, citations).
- **Never run the demo family fixtures** (`tanahpedia_family_*.sql`,
  `cargo make mysql-apply-tanahpedia-families`) over a prod-synced database — their fixed UUIDs
  delete/re-insert rows that API writes may own.
- **Stop before production.** Local apply + readback + rendered verification, then wait for explicit
  approval before replaying against `https://api.xn--febl3a.com/`.
- Never print, commit, or log the bearer token.

## Environment

| Thing         | Value                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| Local GraphQL | `http://127.0.0.1:3003/`                                                            |
| Prod GraphQL  | `https://api.xn--febl3a.com/`                                                       |
| Start API     | `cd web/api && cargo make run-api-dev` (export `TANAHPEDIA_REVISION_API_KEY` first) |
| Website dev   | `cd web/bible-on-site && npm run dev` → port 3001                                   |
| Dev DB        | `mysql://root:test_123@localhost:3306/tanah-dev`                                    |
| Apply task    | `cd devops && npm run tanahpedia:apply -- <ops.json> [--endpoint <url>]`            |

Auth fails closed: every write needs `Authorization: Bearer $TANAHPEDIA_REVISION_API_KEY`, and the
server must have been started with the same value.

## Local data = production copy

`npx tsx devops/setup-dev-env.mts sync-from-prod` (AWS SSO first) restores prod into `tanah-dev`.
The website `predev` now attempts this automatically and keeps existing local data when prod is
unreachable. Never hand-repair local content to match production — re-sync instead.

**After any sync, verify the prod RDS security-group ingress was revoked.** The revoke step can fail
with `ECONNABORTED` and silently leave the DB open to your public IP:

```bash
export AWS_PAGER='' AWS_PROFILE=<sso-profile> AWS_REGION=il-central-1
MYIP=$(curl -s https://checkip.amazonaws.com)
SG=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=tanah-rds-sg" \
      --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 describe-security-groups --group-ids "$SG" \
  --query 'SecurityGroups[0].IpPermissions[].IpRanges[].CidrIp'
aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 3306 --cidr "$MYIP/32"
```

Revoke **only your own** `/32`; the other CIDRs are someone else's access.

## Operation set format

Save every change as a JSON file and apply it with the task — no ad-hoc scripts. The same file is
applied locally, reviewed, then replayed on prod.

```jsonc
{
  "endpoint": "http://127.0.0.1:3003/",
  "entries": [{ "uniqueName": "...", "title": "...", "content": "<p></p>", "entityId": "...", "linkId": "..." }],
  "personNodes": [{ "entityId": "...", "personId": "...", "sexId": "...", "displayName": "...", "sex": "MALE" }],
  "entryEntityLinks": [{ "id": "...", "entryUniqueName": "...", "entityId": "..." }],
  "parentChildLinks": [
    {
      "id": "...",
      "parentPersonId": "...",
      "childPersonId": "...",
      "relationshipType": "BIOLOGICAL",
      "parentRole": "FATHER",
      "sourceCitation": "...",
    },
  ],
  "unions": [{ "id": "...", "person1Id": "...", "person2Id": "...", "unionType": "MARRIAGE" }],
}
```

All IDs are **caller-supplied UUIDs generated once and reused forever** — that is what makes replay
idempotent. Regenerating IDs creates duplicates.

Lookup values (case-insensitive):

- `relationshipType`: `BIOLOGICAL`, `ADOPTIVE`, `STEP`, `FOSTER`
- `parentRole`: `FATHER`, `MOTHER`
- `unionType`: `MARRIAGE`, `PILEGESH`, `FORBIDDEN_WITH_GENTILE`, `BANNED_INCEST`, `BETROTHAL`
- `endReason`: `DEATH`, `DIVORCE`
- Citations: max 400 characters.

## Citation style — must be pasuk-linked

Tanah citations are auto-linked to `/929/<perek>#pasuk-<n>` by
`web/bible-on-site/src/lib/tanahpedia/tanach-citation-links.tsx`. The parser reads
`<sefer> <perek> <pasuk>` as **whitespace-separated Hebrew-letter tokens**, so any punctuation
inside the reference breaks the match and the citation renders as dead plain text.

- **No commas.** Correct: `בראשית יא כו`. Wrong: `בראשית יא, כו` (renders as dead plain text).
- Ranges use a hyphen inside the pasuk token: `בראשית כא ב-ג`.
- Gematria letters only; use ASCII `"` for gershayim, never the Hebrew gershayim character.
- Non-Tanah sources (Gemara, Midrash) legitimately stay unlinked — e.g. `בבא בתרא צא ע"א`.
- After writing, verify the rendered page actually emits `citationTanachLink` anchors. An accepted
  mutation does not prove the citation is linkable.

## Disputed relationships — alt groups, not a single guess

When Rishonim disagree about the **nature** of a relationship (e.g. אשה vs פילגש), never pick one
side. Write one row per opinion and tie them together:

- Same `altGroupId` (a fresh UUID) on every row of the dispute, same partner, same `unionOrder`.
- `unionType` differs per row; each row's `sourceCitation` carries **that opinion's** sources
  (newline-separated when there is more than one).
- `personSourceCitation` is the pasuk establishing the relationship itself, and is identical on
  every row of the group — the dispute is about classification, not existence.
- The UI merges the group into one card, shows the shared `personSourceCitation` on the card, and
  emits a neutral `שיטה א׳ / שיטה ב׳` ribbon per opinion. Attribution comes from the citations —
  never hardcode posek names in the UI.

Example (קטורה): `PILEGESH` with `פשטות המקרא דברי הימים א א לב` + `רש"י בראשית כה ו`, and
`MARRIAGE` with `רד"ק בראשית כה א` + `משמע מרמב"ן בראשית כה א`, both `personSourceCitation`
`בראשית כה א`.

When only one opinion is modeled but the classification still rests on an interpretation
(e.g. יעקב/בלהה/זלפה), keep the split: interpretive source in `sourceCitation`, pasuk in
`personSourceCitation`.

## Required sequence

1. `git fetch` and inspect the checked-out resolvers/schema — never assume a mutation from another branch is deployed.
2. Start the local API against a prod-synced `tanah-dev`; confirm `/health` and one authenticated read before writing.
3. **Discover before writing.** Query `tanahpediaFindPersons`, `tanahpediaPersonDetails`,
   `tanahpediaPersonUnions`, `tanahpediaPersonParentChild`. Exact-name hits are _candidates_, not
   identity — Torah names repeat. Disambiguate by stable ID and entry association.
4. Create person nodes **before** any relationship referencing them.
5. New entries: `submitEntryRevision` → inspect `PENDING` → `applyEntryRevision` → capture `entryId`,
   then `putTanahpediaEntryEntityLink` (which takes `entryUniqueName`, **not** the entry UUID).
6. Apply parent-child links and unions.
7. **Re-run the identical file** to prove idempotency (no duplicates, no timestamp churn).
8. Read back every writable field and exact relationship count through authenticated queries.
9. Verify the **rendered** page and family tree at `http://localhost:3001/pedia/<uniqueName>`.
   HTTP 200 and a successful mutation are not completion evidence.
10. Present the ops file + readback for approval. Only then replay on prod and re-verify on both
    production domains.

## Semantics that are easy to get wrong

- **Siblings are not a relationship type.** Model them by giving both people the same parent link
  (e.g. both children of the same father). There is no sibling edge.
- A `put` is a **full** put: omitting an optional field (e.g. `sexAltGroupId`) clears it.
- A person with no entry still renders in a family tree; an entry is only needed to make the node
  navigable. Do not create empty entries just to show a name.
- Deletes are deliberately narrow and staged: `deleteTanahpediaOrphanPersonNode` refuses while any
  entry link/edge/metadata remains, and leaves the entity behind (it shows as `(אין ערך)` in category
  indexes). Removing that shell is a separate `deleteTanahpediaOrphanEntity` call.

## Windows / Git Bash

- Prefix terminal commands with a leading space.
- Send non-ASCII GraphQL JSON to native `curl` via stdin (`--data-binary @-`); never pass Hebrew
  through argv.
- Prefix commands whose arguments start with `/` (SSM names, `git show "ref:path"`) with
  `MSYS_NO_PATHCONV=1`.
- `export AWS_PAGER='' GH_PAGER=cat GH_FORCE_TTY=0` to keep output auditable.

## Routing reference

Tanahpedia is served under `/pedia`:

- `/pedia` — landing
- `/pedia/<hebrew-category>` — category listing (e.g. `/pedia/אישים`)
- `/pedia/<hebrew-category>?role=<sub>` — canonical filtered listing (e.g. `?role=נביאים`)
- `/pedia/<sub>` — short sugar for a subcategory (e.g. `/pedia/נביאים`)
- `/pedia/<uniqueName>` — entry
- `/tanahpedia/*` and English category slugs 308-redirect to the canonical Hebrew URLs

Slug/category resolution lives in `web/bible-on-site/src/lib/tanahpedia/category-slug.ts`; the
redirects live in `web/bible-on-site/src/proxy.ts`.
