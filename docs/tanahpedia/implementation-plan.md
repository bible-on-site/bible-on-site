# Tanahpedia Implementation Plan

Reference: [tanachpedia.dbml](./tanachpedia.dbml) for complete schema.

## 1. Data Layer

### 1.1 MySQL Migration
- Generate SQL from DBML schema (all `tanahpedia_*` tables)
- Create migration file in `data/mysql/` alongside existing `tanah_*` migrations
- Include lookup table seed data (name types, union types, parent-child types, etc.)

### 1.2 Sea-ORM Entities (API)
- Create entities in `web/api/entities/src/tanahpedia/`:
  - Entry system: `entry.rs`, `entry_synonym.rs`, `entry_entity.rs`
  - Core entities: `person.rs`, `place.rs`, `event.rs`, `war.rs`, `nation.rs`, `animal.rs`, `object.rs`, `plant.rs`, `astronomical_object.rs`, `sefer.rs`, `saying.rs`, `prophecy.rs`
  - Property tables: `person_name.rs`, `person_sex.rs`, `person_birth_date.rs`, etc.
  - Source tables: `source_group.rs`, `tanah_source.rs`, `non_tanah_source.rs`
  - Lookups: `lookup_*.rs`
- Follow existing entity pattern (`DeriveEntityModel`, `Relation`, `ActiveModelBehavior`)

### 1.3 TypeScript Types (Website)
- Create types in `web/bible-on-site/src/lib/tanahpedia/types.ts`
- Mirror DBML structure with TypeScript interfaces

### 1.4 C# Models (App)
- Create models in `app/BibleOnSite/Models/Tanahpedia/`
- Include `Entry.cs`, `Person.cs`, `Place.cs`, etc.

## 2. Data Population

### 2.1 Test Data
- Create dedicated test fixtures in `web/bible-on-site/tests/fixtures/tanahpedia/`
- Include sample entries, persons, places for unit/integration tests
- Use predictable GUIDs for test assertions

### 2.2 Dev Data
- Script to copy prod tanahpedia tables to dev DB
- Add to existing dev setup scripts

## 3. Website Implementation

### 3.1 Navigation
- Add "תנ"ךפדיה" item to `web/bible-on-site/src/app/components/NavBar.tsx`
- Link to `/tanahpedia`

### 3.2 Routes (Next.js App Router)

```
web/bible-on-site/src/app/tanahpedia/
├── page.tsx                      # Landing page
├── layout.tsx                    # Tanahpedia layout
├── [entityType]/
│   └── page.tsx                  # Entity type listing (person, place, etc.)
└── entry/
    └── [uniqueName]/
        └── page.tsx              # Individual entry page
```

### 3.3 Entity Type Listing Page Behavior

On `/tanahpedia/person` (and similar entity pages), list all entities with entry linking:

| Linked Entries | Display | Behavior |
|----------------|---------|----------|
| 0 entries | `אדם` (plain text) | Non-clickable, no link |
| 1 entry | `אדם` (link) | Clickable, navigates directly to entry |
| 2+ entries | `דתן [דתן, דתן ואבירם]` | Shows disambiguation bracket with entry links |

**Component:** `EntityListItem.tsx` – entity name with conditional entry links (0/1/many).

### 3.4 Database Access
- Create `web/bible-on-site/src/lib/tanahpedia/service.ts` with `getEntries()`, `getEntryByUniqueName()`, `getEntriesByEntityType()`, `getEntitiesWithEntries()`, `getEntity<T>()`
- Direct MySQL via existing `query()` in `api-client.ts`

### 3.5 Components
- Entry: `EntryContent.tsx`, `EntityBadge.tsx`
- Entity cards: `PersonCard`, `PlaceCard`, `EventCard`, `WarCard`, `NationCard`, `SayingCard`, `ProphecyCard`, `FamilyTree`
- Nav: `TanahpediaBreadcrumb`, `EntityTypeNav`, `EntityListItem`

### 3.6 Landing Page
- Search, entity type cards with counts, recent/featured entries

## 4. Mobile App Implementation

- Nav: flyout item, routes `TanahpediaPage`, `TanahpediaEntryPage`, `TanahpediaEntityTypePage`
- Service: GraphQL queries for entries, entry by name, entries by entity type
- Pages, ViewModels, entity display controls (same listing behavior as website)

## 5. API Implementation

- GraphQL schema, resolvers (`entries`, `persons`, etc.), services, DTOs (including `linkedEntries` for listing)

## 6. Admin Panel Implementation

**Feature order:** (1) Entry content HTML editor, (2) Centralized AI-assisted edits (first AI feature).

### 6.0 Centralized AI-Assisted Edits (first admin feature after entry editor)

Single admin flow for **reference linking** (articles → entries) and **entry/entity creation**:

- **Inputs:** Entity type (optional; from enum; if omitted, AI may pick/suggest), Entity name (optional; if omitted, AI may suggest from context)
- **Output:** AI-generated draft (entry + entity and/or article→entry links) for human review/triage
- **Use cases:** Suggest entries for articles, suggest new entry/entity from name+type, backlinks when creating an entry

### 6.1–6.4
- Server functions for entries and all entity types; routes; components (EntryEditor, entity editors, AlternativeValuesEditor, SourceGroupEditor, DatePicker, EntityPicker); sidebar nav

## Future Plans

1. **Centralized AI-assisted edits** – Implement §6.0
2. **AI-assisted entry identification in articles**
3. **Auto-trigger backlinks on entry creation**
4. **Articles edit page: AI suggestions + human triage**
