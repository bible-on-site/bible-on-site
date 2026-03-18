# Tanahpedia Implementation Plan

Reference: [tanachpedia.dbml](./tanachpedia.dbml) for complete schema.

**Execution order:** Data (DDL) → Website → Admin → Legacy migration

**Architecture:**
- Central `tanahpedia_entity` base table: every concrete entity (person, place, etc.) has a 1:1 row. Shared fields (name, type) live here; type-specific fields live in the concrete table.
- `tanahpedia_entity` serves as the clean FK target for `entry_entity` and `entity_tanah_source` (no polymorphic columns).
- **Inheritance chain:** War extends Event; Prophecy extends Saying; Temple Tool extends Object.
- **Entity-level Tanah sources** (`entity_tanah_source`): direct Tanah text references (no perush), with sub-pasuk segment resolution. Property-level sources (`source_group`) still support perush references.
- **Full resolution chain** (API returns all components): `tanah_helek` → `tanah_sefer` → `tanah_perek` → `pasuk_number` → `segment_start..end`. The `tanah_perek.id` determines helek and sefer via `tanah_sefer.perek_id_from/to`.
- `tanah_pasuk_segment` (SQLite/JSON) provides segment metadata (ktiv, qri, ptuha, stuma) for sub-pasuk resolution.

## 1. Data Layer

### 1.1 MySQL Migration (#1242)
- Generate SQL from DBML schema (all `tanahpedia_*` tables)
- Create migration file in `data/mysql/` alongside existing `tanah_*` migrations
- Include lookup table seed data (name types, union types, parent-child types, etc.)
- Tables include:
  - `tanahpedia_entity` (base table for all entity types)
  - `tanahpedia_entity_tanah_source` (entity-level Tanah references with segment resolution)
  - `tanahpedia_temple_tool` (extends `tanahpedia_object` via 1:1 FK)
  - `tanahpedia_3d_model` (points to `tanahpedia_entity.id`)
  - `tanahpedia_category_homepage` (one per entity type; layout_type + JSON config)

### 1.2 Sea-ORM Entities (API) (#1243)
- Create entities in `web/api/entities/src/tanahpedia/`:
  - Entry system: `entry.rs`, `entry_synonym.rs`, `entry_entity.rs`
  - Core entities: `person.rs`, `place.rs`, `event.rs`, `war.rs`, `nation.rs`, `animal.rs`, `object.rs`, `temple_tool.rs`, `plant.rs`, `astronomical_object.rs`, `sefer.rs`, `saying.rs`, `prophecy.rs`
  - Property tables: `person_name.rs`, `person_sex.rs`, `person_birth_date.rs`, etc.
  - Source tables: `source_group.rs`, `tanah_source.rs`, `non_tanah_source.rs`
  - New: `three_d_model.rs`, `category_homepage.rs`
  - Lookups: `lookup_*.rs`
- Follow existing entity pattern (`DeriveEntityModel`, `Relation`, `ActiveModelBehavior`)

### 1.3 TypeScript Types (Website)
- Create types in `web/bible-on-site/src/lib/tanahpedia/types.ts`
- Mirror DBML structure with TypeScript interfaces
- Include `ThreeDModel`, `TempleTool`, `CategoryHomepage` types

### 1.4 C# Models (App)
- Create models in `app/BibleOnSite/Models/Tanahpedia/`
- Include `Entry.cs`, `Person.cs`, `Place.cs`, `TempleTool.cs`, `ThreeDModel.cs`, `CategoryHomepage.cs`, etc.

## 2. Data Population (#1248)

### 2.1 Test Data
- Create dedicated test fixtures in `web/bible-on-site/tests/fixtures/tanahpedia/`
- Include sample entries, persons, places for unit/integration tests
- Use predictable GUIDs for test assertions

### 2.2 Dev Data
- Script to copy prod tanahpedia tables to dev DB
- Add to existing dev setup scripts

### 2.3 Legacy Migration
- Parse and migrate existing legacy entries from the old project:
  - `תנכפדיה/אישים/יהושע/גיבוי.html`
  - `תנכפדיה/אישים/עלי/גיבוי.html`
  - `תנכפדיה/אישים/שמשון/גיבוי.html`
- Extract HTML content into `tanahpedia_entry.content`
- Create corresponding `tanahpedia_person` entities and link via `tanahpedia_entry_entity`

## 3. Website Implementation (#1245)

### 3.1 Navigation
- Add "תנכפדיה" item to `web/bible-on-site/src/app/components/NavBar.tsx`
- Link to `/tanahpedia`

### 3.2 Routes (Next.js App Router)

```
web/bible-on-site/src/app/tanahpedia/
├── page.tsx                      # Landing page
├── layout.tsx                    # Tanahpedia layout
├── [entityType]/
│   └── page.tsx                  # Category homepage (custom layout per entity type)
└── entry/
    └── [uniqueName]/
        └── page.tsx              # Individual entry page
```

### 3.3 Category Homepages

Each entity type gets a configurable homepage driven by `tanahpedia_category_homepage`:

| Entity Type | Layout | Description |
|-------------|--------|-------------|
| PLACE | MAP | OpenGIS/Leaflet map showing place identifications with coordinates |
| OBJECT / TEMPLE_TOOL | GALLERY | 3D model gallery with interactive viewer |
| ANIMAL / PLANT | GALLERY | 3D model gallery + list |
| PERSON | LIST | Alphabetical list with family tree snippets |
| EVENT | TIMELINE | Chronological timeline view |
| WAR | TIMELINE | Timeline with war sides visualization |
| Others | LIST | Default entity list with entry links |

**Layout components:**
- `CategoryHomepage.tsx` - Layout dispatcher based on `layout_type`
- `MapLayout.tsx` - Leaflet/OpenLayers GIS view with markers for place identifications
- `GalleryLayout.tsx` - 3D model gallery grid with inline viewer
- `TimelineLayout.tsx` - Chronological entity timeline
- `ListLayout.tsx` - Default alphabetical entity list

### 3.4 Entity Type Listing Page Behavior

On `/tanahpedia/person` (and similar entity pages), list all entities with entry linking:

| Linked Entries | Display | Behavior |
|----------------|---------|----------|
| 0 entries | `אדם` (plain text) | Non-clickable, no link |
| 1 entry | `אדם` (link) | Clickable, navigates directly to entry |
| 2+ entries | `דתן [דתן, דתן ואבירם]` | Shows disambiguation bracket with entry links |

**Component:** `EntityListItem.tsx` – entity name with conditional entry links (0/1/many).

### 3.5 3D Model Viewer

- Integrate Three.js / `@google/model-viewer` for rendering GLB/glTF models
- `ModelViewer.tsx` - Renders a single 3D model with orbit controls, zoom, lighting
- `ModelGallery.tsx` - Grid of model thumbnails → click to open viewer
- Used in: Object, Temple Tool, Animal, Plant entry pages and category gallery homepages
- Models loaded from S3/blob storage via `blob_key`

### 3.6 Database Access
- Create `web/bible-on-site/src/lib/tanahpedia/service.ts` with:
  - `getEntries()` - List entries with pagination
  - `getEntryByUniqueName(name)` - Single entry with related entities (joins through `tanahpedia_entity` base)
  - `getEntriesByEntityType(type)` - Entries for entity type page (joins through `tanahpedia_entity`)
  - `getEntitiesWithEntries(type)` - All entities of type with their linked entries
  - `getEntity<T>(type, id)` - Get specific entity with all props
  - `getCategoryHomepage(entityType)` - Get homepage config for entity type
  - `get3DModels(entityId)` - Get 3D models for an entity (via `tanahpedia_entity.id`)
  - `getEntityReferencesForPerek(perekId)` - Entity references for tanah al haperek integration
- Direct MySQL via existing `query()` in `api-client.ts`

### 3.7 Components

Create in `web/bible-on-site/src/app/tanahpedia/components/`:

**Entry Display:**
- `EntryContent.tsx` - Renders entry content with embedded entity components
- `EntityBadge.tsx` - Shows linked entity type badges

**Entity-Specific Components (for embedding in content):**
- `PersonCard.tsx` - Name, dates, family tree snippet
- `PlaceCard.tsx` - Name, coordinates, identification
- `EventCard.tsx` - Name, date range, location
- `WarCard.tsx` - Sides, participants
- `NationCard.tsx` - Territory, source nations
- `ObjectCard.tsx` - Name, 3D model preview
- `TempleToolCard.tsx` - Extends ObjectCard with temple-specific context
- `AnimalCard.tsx` - Name, 3D model preview
- `PlantCard.tsx` - Name, creation day, 3D model preview
- `SayingCard.tsx` - Speaker, audience, content
- `ProphecyCard.tsx` - Prophet, recipients, is_good
- `FamilyTree.tsx` - Visual family relationships

**3D Model:**
- `ModelViewer.tsx` - Interactive 3D model renderer
- `ModelGallery.tsx` - Grid of 3D model previews

**Category Homepages:**
- `CategoryHomepage.tsx` - Layout dispatcher
- `MapLayout.tsx` - GIS map view (Leaflet/OpenLayers)
- `GalleryLayout.tsx` - 3D model gallery
- `TimelineLayout.tsx` - Chronological view
- `ListLayout.tsx` - Default list view

**Navigation:**
- `TanahpediaBreadcrumb.tsx` - Entry/entity navigation
- `EntityTypeNav.tsx` - Filter by entity type
- `EntityListItem.tsx` - Entity name with conditional entry links

### 3.8 Landing Page
- Search box for entries
- Entity type cards (Person, Place, Event, Object, Temple Tool, etc.) with counts
- Recent/featured entries

### 3.9 Tanah al Haperek Integration

**Goal:** When an entity appears in a pasuk (via `entity_tanah_source`), the corresponding text segment in "Tanah al Haperek" becomes a clickable `<a>` linking to the Tanahpedia entry.

**Data flow:**
1. `getEntityReferencesForPerek(perekId)` queries `entity_tanah_source` → `entity` → `entry_entity` → `entry`
2. Returns: `{ entityName, entityType, entryUniqueName, pasukNumber, segmentStart, segmentEnd }`
3. Website resolves pasuk text from static JSON, identifies the matching text range, and wraps it in `<a href="/tanahpedia/entry/{uniqueName}">`.
4. If `segmentStart`/`segmentEnd` are NULL, the entire pasuk text is linked.
5. If segments are specified, only the matching sub-pasuk range is wrapped.

**Full resolution chain (for API / future app):**
- `tanah_perek.id` → join `tanah_sefer` (via `perek_id_from`/`perek_id_to`) → join `tanah_helek` (via `sefer_id_from`/`sefer_id_to`)
- `pasuk_number` = 1-based index within perek
- `segment_start`/`segment_end` = 0-based indexes into `tanah_pasuk_segment` / static JSON segments

**Rendering approach:**
- Segments within a pasuk are partitioned into contiguous "runs" — each run is either plain or linked to a single entity reference.
- A linked run wraps **all** its segments in a single `<a>` tag (e.g. "יהושע בן נון" = 3 segments, 1 link).
- Utility: `getSegmentRuns()` in `entity-ref-lookup.ts` partitions segments; `renderSegmentRange()` in `page.tsx` renders a run.

**Components:**
- `entity-ref-lookup.ts` - Builds lookup + partitions segments into runs
- Integration into existing perek page rendering pipeline (`929/[number]/page.tsx`)

**Planned for:**
- Website: current milestone
- App: future milestone (via GraphQL API returning the same data)

## 4. Mobile App Implementation (#1246)

### 4.1 Navigation
- Add flyout item in `app/BibleOnSite/AppShell.xaml`
- Register routes: `TanahpediaPage`, `TanahpediaEntryPage`, `TanahpediaEntityTypePage`

### 4.2 GraphQL Queries
- Add queries to `app/BibleOnSite/Services/TanahpediaService.cs`:
  - `GetEntriesAsync()`
  - `GetEntryAsync(uniqueName)`
  - `GetEntriesByEntityTypeAsync(type)`
  - `GetCategoryHomepageAsync(type)`
  - `Get3DModelsAsync(entityType, entityId)`

### 4.3 Pages

Create in `app/BibleOnSite/Pages/Tanahpedia/`:
- `TanahpediaPage.xaml` - Landing with search and entity type grid
- `TanahpediaEntryPage.xaml` - Entry display with entity components
- `TanahpediaEntityTypePage.xaml` - Category homepage (map/gallery/timeline/list per type)

### 4.4 ViewModels
- `TanahpediaViewModel.cs`
- `TanahpediaEntryViewModel.cs`
- `TanahpediaEntityTypeViewModel.cs`

### 4.5 Controls

Create in `app/BibleOnSite/Controls/Tanahpedia/`:
- `PersonCardView.xaml` - Person entity display
- `PlaceCardView.xaml` - Place with map pin
- `ObjectCardView.xaml` - Object with 3D model preview
- `TempleToolCardView.xaml` - Temple tool with 3D model
- `AnimalCardView.xaml` - Animal with 3D model preview
- `PlantCardView.xaml` - Plant with 3D model preview
- `ModelViewer3D.xaml` - 3D model renderer (WebView-based GLB/glTF viewer)
- Similar for other entity types

## 5. API Implementation (#1244)

### 5.1 GraphQL Schema
Add to `web/api/src/startup/schema_builder.rs`

### 5.2 Resolvers

Create in `web/api/src/resolvers/tanahpedia/`:
- `entries_resolver.rs`: `entries(limit, offset)`, `entryByUniqueName(name)`, `entriesByEntityType(type)`
- `persons_resolver.rs`: `persons` (with linked entries), `personById(id)`
- `objects_resolver.rs`: includes temple tools; `objectById(id)` with 3D models
- `category_homepage_resolver.rs`: `categoryHomepage(entityType)`
- Similar for places, events, animals, plants, etc.

### 5.3 Services

Create in `web/api/src/services/tanahpedia/`:
- `entries_service.rs`
- `persons_service.rs`
- `three_d_models_service.rs`
- `category_homepage_service.rs`
- Entity-specific services for complex queries (family tree, etc.)

### 5.4 DTOs

Create in `web/api/src/dtos/tanahpedia/`:
- `entry.rs` - Entry with embedded entity summaries
- `person.rs` - Person with all properties + `linkedEntries: [EntryStub]`
- `entry_stub.rs` - Lightweight entry reference (id, unique_name, title)
- `temple_tool.rs` - Temple tool extending object DTO
- `three_d_model.rs` - 3D model metadata + presigned URL
- `category_homepage.rs` - Homepage config with layout_type and config
- Similar for other entities (all include linkedEntries for listing page)

## 6. Admin Panel Implementation (#1247)

**Feature order:** (1) Entry content HTML editor, (2) Centralized AI-assisted edits (first AI feature).

### 6.0 Centralized AI-Assisted Edits (#1241) (first admin feature after entry editor)

Single admin flow for **reference linking** (articles → entries) and **entry/entity creation**:

- **Inputs:** Entity type (optional; from enum; if omitted, AI may pick/suggest), Entity name (optional; if omitted, AI may suggest from context)
- **Output:** AI-generated draft (entry + entity and/or article→entry links) for human review/triage
- **Use cases:** Suggest entries for articles, suggest new entry/entity from name+type, backlinks when creating an entry

#### 6.0.1 AI-Assisted Entity Tanah Source Generation

When creating or editing a tanahpedia entity, the AI automatically suggests `entity_tanah_source` references — pesukim (with segment-level precision) where the entity appears in the Tanah text.

**Two matching strategies:**

1. **Phrase matching** — Scan the Tanah text for literal occurrences of the entity name and known synonyms (from `person_name`, `entry_synonym`, etc.). Match against segments to produce exact `(perek_id, pasuk_number, segment_start, segment_end)` tuples.
   - Handles morphological variants (e.g. "יְהוֹשֻׁעַ" vs "יהושע", with/without nikud)
   - Handles multi-segment names (e.g. "יהושע בן נון" → 3 segments)
   - Handles partial names when unambiguous in context (e.g. "יהושע" alone in Sefer Yehoshua)

2. **Semantic/contextual matching** — Use LLM analysis to identify pesukim that refer to the entity without naming it explicitly:
   - Pronouns and implicit references (e.g. "וַיֹּאמֶר אֲלֵיהֶם" where "אֲלֵיהֶם" refers to a specific nation)
   - Titles and roles (e.g. "עֶבֶד יְהוָה" referring to Moshe in context)
   - Contextual inference from surrounding pesukim (e.g. subject continuation across pesukim)
   - Perush-informed identification (using commentary to resolve ambiguous references)

**Output:** A ranked list of suggested references, each with:
- `perek_id`, `pasuk_number`, `segment_start`, `segment_end`
- Confidence level (high/medium/low)
- Match type (phrase / semantic)
- Reasoning (for semantic matches: why the AI believes this refers to the entity)

**Human review:** All suggestions go through admin triage — the human approves, edits, or rejects each suggestion before it becomes an `entity_tanah_source` row. Phrase matches with high confidence can be auto-approved in bulk.

### 6.1 Database Functions

Create in `web/admin/src/server/tanahpedia/`:
- `entries.ts`: `getEntries()`, `getEntry(id)`, `createEntry()`, `updateEntry()`, `deleteEntry()`, `assignEntityToEntry()`, `removeEntityFromEntry()`
- `persons.ts`, `places.ts`, `objects.ts`, `temple_tools.ts`, etc. - CRUD for each entity type
- `three_d_models.ts` - Upload/delete 3D models (S3 presigned upload + DB record)
- `category_homepages.ts` - CRUD for category homepage configs

### 6.2 Routes

Create in `web/admin/src/routes/tanahpedia/`:

```
tanahpedia/
├── index.tsx           # Tanahpedia admin landing
├── entries.tsx         # Entries list
├── entries.$id.tsx     # Entry editor (content + entity assignment)
├── persons.tsx         # Persons list
├── persons.$id.tsx     # Person editor (all props)
├── places.tsx          # Places list
├── places.$id.tsx      # Place editor
├── objects.tsx         # Objects list (includes temple tools)
├── objects.$id.tsx     # Object editor (with 3D model upload)
├── temple-tools.tsx    # Temple tools list
├── temple-tools.$id.tsx # Temple tool editor
├── category-homepages.tsx       # Category homepage settings
├── category-homepages.$type.tsx # Edit homepage for entity type
└── ... (similar for other entity types)
```

### 6.3 Components

Create in `web/admin/src/components/tanahpedia/`:

**Entry Editor:**
- `EntryEditor.tsx` - Content editor + entity assignment panel
- `EntityAssignment.tsx` - Add/remove entities to entry
- `SynonymManager.tsx` - Manage entry synonyms

**Entity Editors (with alternatives support):**
- `PersonEditor.tsx` - Names, sex, dates, birth place
- `PlaceEditor.tsx` - Name, identifications (with map coordinate picker)
- `EventEditor.tsx` - Name, places, date ranges
- `ObjectEditor.tsx` - Name, 3D model upload/management
- `TempleToolEditor.tsx` - Extends ObjectEditor with temple-specific fields
- `AnimalEditor.tsx` - Name, 3D model upload
- `PlantEditor.tsx` - Name, creation day, 3D model upload
- `FamilyRelationEditor.tsx` - Unions, parent-child relationships

**3D Model Management:**
- `ModelUploader.tsx` - Upload GLB/glTF/OBJ files to S3
- `ModelPreview.tsx` - Preview uploaded 3D model in editor

**Category Homepage:**
- `CategoryHomepageEditor.tsx` - Configure layout type, JSON config, content

**Shared:**
- `AlternativeValuesEditor.tsx` - Manage alt_group_id values
- `SourceGroupEditor.tsx` - Attach sources to any property
- `DatePicker.tsx` - Hebrew date picker (YYYYMMDD format)
- `EntityPicker.tsx` - Search and select entities

### 6.4 Navigation
- Add "תנכפדיה" section to `web/admin/src/routes/__root.tsx` sidebar

## Architecture Diagram

```mermaid
graph TB
    subgraph DataLayer[Data Layer]
        MySQL[(MySQL tanahpedia_*)]
        EntityBase[tanahpedia_entity base]
        EntitySources[entity_tanah_source]
        S3[(S3 - 3D Models)]
        Migration[SQL Migration]
        SeaORM[Sea-ORM Entities]
        TSTypes[TypeScript Types]
        CSModels[C# Models]
        EntityBase --> EntitySources
    end

    subgraph Website[Website - Next.js]
        WebNav[NavBar]
        WebRoutes[/tanahpedia routes]
        WebService[tanahpedia/service.ts]
        WebComponents[Entity Components]
        WebCatHome[Category Homepages]
        Web3D[3D Model Viewer]
        WebPerek[Tanah al Haperek]
        WebNav --> WebRoutes
        WebRoutes --> WebService
        WebService --> MySQL
        WebRoutes --> WebComponents
        WebRoutes --> WebCatHome
        WebComponents --> Web3D
        WebCatHome --> Web3D
        Web3D --> S3
        WebPerek -->|entity refs| WebService
        WebPerek -->|links to| WebRoutes
    end

    subgraph API[API - Rust/Actix]
        GQL[GraphQL Schema]
        Resolvers[Resolvers]
        Services[Services]
        GQL --> Resolvers
        Resolvers --> Services
        Services --> SeaORM
        SeaORM --> MySQL
    end

    subgraph App[App - .NET MAUI]
        AppNav[Shell Flyout]
        AppPages[Tanahpedia Pages]
        AppService[TanahpediaService]
        AppControls[Entity Controls]
        App3D[3D Viewer WebView]
        AppNav --> AppPages
        AppPages --> AppService
        AppService --> GQL
        AppPages --> AppControls
        AppControls --> App3D
        App3D --> S3
    end

    subgraph Admin[Admin - React/TanStack]
        AdminNav[Sidebar]
        AdminRoutes[/tanahpedia routes]
        AdminServer[Server Functions]
        AdminEditors[Entity Editors]
        AdminModel[3D Model Upload]
        AdminCatHome[Category Homepage Editor]
        AdminNav --> AdminRoutes
        AdminRoutes --> AdminServer
        AdminServer --> MySQL
        AdminServer --> S3
        AdminRoutes --> AdminEditors
        AdminEditors --> AdminModel
        AdminRoutes --> AdminCatHome
    end
```

## Key Design Decisions

1. **Entity base table**: Central `tanahpedia_entity` with 1:1 join to concrete entity tables. Eliminates polymorphic `entity_type`+`entity_id` columns; provides clean FK target.
2. **Two-tier source system**: Entity-level (`entity_tanah_source`) for direct Tanah text references with segment resolution; property-level (`source_group`) for Tanah+perush and non-Tanah sources.
3. **Website**: Direct MySQL (like articles) - faster, simpler for read-heavy pages
4. **App**: GraphQL API (like tanah) - offline-friendly, typed queries
5. **Admin**: Server functions (like existing) - direct DB, no API overhead
6. **Alternatives**: All property editors support alt_group_id for multiple interpretations
7. **Inheritance**: Temple Tool extends Object (like War extends Event, Prophecy extends Saying)
8. **3D Models**: Blob storage (S3) with DB metadata; rendered via Three.js/model-viewer on web, WebView on app
9. **Category Homepages**: DB-driven layout config per entity type; supports MAP (GIS), GALLERY, TIMELINE, LIST
10. **Tanah al haperek**: Entity references in pasuk text become clickable `<a>` links to tanahpedia entries

## Future Plans

1. **Centralized AI-assisted edits** – Implement §6.0
2. **AI-assisted entity Tanah source generation** – Implement §6.0.1 (phrase + semantic matching for auto-populating `entity_tanah_source`)
3. **AI-assisted entry identification in articles**
4. **Auto-trigger backlinks on entry creation**
5. **Articles edit page: AI suggestions + human triage**
