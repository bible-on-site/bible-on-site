export type EntityType =
	| "PERSON"
	| "PLACE"
	| "EVENT"
	| "WAR"
	| "ANIMAL"
	| "OBJECT"
	| "TEMPLE_TOOL"
	| "PLANT"
	| "ASTRONOMICAL_OBJECT"
	| "SAYING"
	| "SEFER"
	| "TANAH_SEFER"
	| "PROPHECY"
	| "NATION";

export type PersonRole = "PROPHET" | "KING";

export type AnimalKind = "BEHEMA" | "CHAYA" | "OF" | "SHERETZ";
export type AnimalPurity = "TAHOR" | "TAMEH";
export type AnimalClassification = AnimalKind | AnimalPurity;

export type CategoryKey = EntityType | PersonRole | AnimalClassification;

export type Sex = "MALE" | "FEMALE" | "UNKNOWN";

export type LayoutType = "LIST" | "MAP" | "GALLERY" | "TIMELINE";

// ─── Entry System ──────────────────────────────────────────

export interface Entry {
	id: string;
	uniqueName: string;
	title: string;
	content: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface EntrySynonym {
	id: string;
	name: string;
	entryId: string;
}

export interface EntrySynonymDisambiguation {
	id: string;
	synonymId: string;
	entryId: string;
	disambiguationLabel: string;
}

export interface EntryEntity {
	id: string;
	entryId: string;
	entityId: string;
}

// ─── Sources ───────────────────────────────────────────────

export interface SourceGroup {
	id: string;
	targetTable: string;
	targetId: string;
}

export interface TanahSource {
	id: string;
	sourceGroupId: string;
	perushId: number | null;
	perekId: number | null;
	pasukNumber: number | null;
}

export interface NonTanahSource {
	id: string;
	sourceGroupId: string;
	sourceText: string;
}

// ─── Entity Base ──────────────────────────────────────────

export interface TanahpediaEntity {
	id: string;
	entityType: EntityType;
	name: string;
	createdAt: string;
	updatedAt: string;
}

// ─── Entity-Level Tanah Source ────────────────────────────
// Direct Tanah text references (no perush). Sub-pasuk resolution via segments.

export interface EntityTanahSource {
	id: string;
	entityId: string;
	perekId: number;
	pasukNumber: number;
	segmentStart: number | null;
	segmentEnd: number | null;
}

// ─── Person ────────────────────────────────────────────────

export interface Person {
	id: string;
	entityId: string;
}

export interface PersonName {
	id: string;
	personId: string;
	name: string;
	nameTypeId: string;
	altGroupId: string | null;
}

export interface PersonNameGiverPerson {
	id: string;
	personNameId: string;
	giverPersonId: string;
	altGroupId: string | null;
}

export interface PersonNameGiverGod {
	id: string;
	personNameId: string;
	godId: string;
	altGroupId: string | null;
}

export interface PersonSex {
	id: string;
	personId: string;
	sex: Sex;
	altGroupId: string | null;
}

export interface PersonBirthDate {
	id: string;
	personId: string;
	birthDate: number;
	altGroupId: string | null;
}

export interface PersonDeathDate {
	id: string;
	personId: string;
	deathDate: number;
	altGroupId: string | null;
}

export interface PersonDeathCause {
	id: string;
	personId: string;
	deathCause: string;
	altGroupId: string | null;
}

export interface PersonBirthPlace {
	id: string;
	personId: string;
	placeId: string;
	altGroupId: string | null;
}

// ─── Place ─────────────────────────────────────────────────

export interface Place {
	id: string;
	entityId: string;
}

export interface PlaceIdentification {
	id: string;
	placeId: string;
	modernName: string | null;
	latitude: number | null;
	longitude: number | null;
	altGroupId: string | null;
}

// ─── Event ─────────────────────────────────────────────────

export interface TanahpediaEvent {
	id: string;
	entityId: string;
}

export interface EventPlace {
	id: string;
	eventId: string;
	placeId: string;
	altGroupId: string | null;
}

export interface EventDateRange {
	id: string;
	eventId: string;
	startDate: number | null;
	endDate: number | null;
	altGroupId: string | null;
}

// ─── War (extends Event) ──────────────────────────────────

export interface War {
	id: string;
	eventId: string;
	entityId: string;
}

export interface WarSide {
	id: string;
	warId: string;
	sideNumber: number;
}

export interface WarSideParticipantPerson {
	id: string;
	warSideId: string;
	personId: string;
	altGroupId: string | null;
}

export interface WarSideParticipantNation {
	id: string;
	warSideId: string;
	nationId: string;
	altGroupId: string | null;
}

// ─── Nation ────────────────────────────────────────────────

export interface Nation {
	id: string;
	entityId: string;
}

export interface NationSourceNation {
	id: string;
	nationId: string;
	sourceNationId: string;
	altGroupId: string | null;
}

export interface NationTerritory {
	id: string;
	nationId: string;
	placeId: string;
	startDate: number | null;
	endDate: number | null;
	altGroupId: string | null;
}

// ─── Animal ────────────────────────────────────────────────

export interface Animal {
	id: string;
	entityId: string;
}

// ─── Object ────────────────────────────────────────────────

export interface TanahpediaObject {
	id: string;
	entityId: string;
}

// ─── Temple Tool (extends Object) ─────────────────────────

export interface TempleTool {
	id: string;
	objectId: string;
	entityId: string;
}

// ─── 3D Model ──────────────────────────────────────────────

export type ThreeDModelEntityType =
	| "OBJECT"
	| "TEMPLE_TOOL"
	| "ANIMAL"
	| "PLANT";

export interface ThreeDModel {
	id: string;
	entityId: string;
	blobKey: string;
	format: string;
	label: string | null;
	altGroupId: string | null;
}

// ─── Category Homepage ────────────────────────────────────

export interface CategoryHomepage {
	id: string;
	entityType: EntityType;
	layoutType: LayoutType;
	config: Record<string, unknown> | null;
	content: string | null;
	updatedAt: string;
}

// ─── Plant ─────────────────────────────────────────────────

export interface Plant {
	id: string;
	entityId: string;
}

export interface PlantCreationDay {
	id: string;
	plantId: string;
	creationDay: number;
	altGroupId: string | null;
}

// ─── Astronomical Object ──────────────────────────────────

export interface AstronomicalObject {
	id: string;
	entityId: string;
}

export interface AstronomicalObjectCreationDay {
	id: string;
	astronomicalObjectId: string;
	creationDay: number;
	altGroupId: string | null;
}

// ─── Sefer (Tanahpedia) ──────────────────────────────────

export interface TanahpediaSefer {
	id: string;
	entityId: string;
}

export interface SeferTanahMatch {
	id: string;
	seferId: string;
	tanahSeferId: number;
	altGroupId: string | null;
}

// ─── Saying ────────────────────────────────────────────────

export interface Saying {
	id: string;
	entityId: string;
	content: string | null;
}

export interface SayingLocation {
	id: string;
	sayingId: string;
	placeId: string;
	altGroupId: string | null;
}

export interface SayingSpeakerPerson {
	id: string;
	sayingId: string;
	personId: string;
	altGroupId: string | null;
}

export interface SayingSpeakerNation {
	id: string;
	sayingId: string;
	nationId: string;
	altGroupId: string | null;
}

export interface SayingSpeakerGod {
	id: string;
	sayingId: string;
	godId: string;
	altGroupId: string | null;
}

export interface SayingAudiencePerson {
	id: string;
	sayingId: string;
	personId: string;
	altGroupId: string | null;
}

export interface SayingAudienceNation {
	id: string;
	sayingId: string;
	nationId: string;
	altGroupId: string | null;
}

// ─── Prophecy (extends Saying) ────────────────────────────

export interface Prophecy {
	id: string;
	sayingId: string;
	entityId: string;
}

export interface ProphecyIsGood {
	id: string;
	prophecyId: string;
	isGood: boolean;
	altGroupId: string | null;
}

export interface ProphecyProphet {
	id: string;
	prophecyId: string;
	personId: string;
	altGroupId: string | null;
}

export interface ProphecyRecipientPerson {
	id: string;
	prophecyId: string;
	personId: string;
	altGroupId: string | null;
}

export interface ProphecyRecipientNation {
	id: string;
	prophecyId: string;
	nationId: string;
	altGroupId: string | null;
}

// ─── Family Relationships ─────────────────────────────────

export interface LookupUnionType {
	id: string;
	name: string;
}

export interface LookupUnionEndReason {
	id: string;
	name: string;
}

export interface PersonUnion {
	id: string;
	person1Id: string;
	person2Id: string;
	unionTypeId: string;
	unionOrder: number | null;
	startDate: number | null;
	endDate: number | null;
	endReasonId: string | null;
	altGroupId: string | null;
}

export interface LookupParentChildType {
	id: string;
	name: string;
}

export interface LookupParentRole {
	id: string;
	name: string;
}

export interface PersonParentChild {
	id: string;
	parentId: string;
	childId: string;
	relationshipTypeId: string;
	parentRoleId: string;
	altGroupId: string | null;
}

// ─── Lookup: Name Types ───────────────────────────────────

export interface LookupNameType {
	id: string;
	name: string;
}

// ─── God (singleton) ──────────────────────────────────────

export interface God {
	id: string;
}

// ─── Composite / Display Types ────────────────────────────

export interface EntityWithEntries {
	entityType: EntityType;
	entityId: string;
	entityName: string;
	linkedEntries: EntryStub[];
}

export interface EntryStub {
	id: string;
	uniqueName: string;
	title: string;
}

export interface EntryWithEntities extends Entry {
	entities: (EntryEntity & { entityType: EntityType; entityName: string })[];
}

// ─── Person family (non-entry entity data on website) ─────

export interface PersonFamilyRelatedPerson {
	personId: string;
	entityId: string;
	displayName: string;
	entryUniqueName: string | null;
	entryTitle: string | null;
}

export interface PersonFamilyParentEdge {
	related: PersonFamilyRelatedPerson;
	parentRole: string;
	relationshipType: string;
	altGroupId: string | null;
	sourceCitation: string | null;
}

export interface PersonFamilyChildEdge {
	related: PersonFamilyRelatedPerson;
	parentRole: string;
	relationshipType: string;
	altGroupId: string | null;
	sourceCitation: string | null;
}

export interface PersonFamilySpouseEdge {
	related: PersonFamilyRelatedPerson;
	unionType: string;
	unionOrder: number | null;
	altGroupId: string | null;
	sourceCitation: string | null;
	/** Lookup code e.g. DEATH, DIVORCE when union ended */
	unionEndReason: string | null;
	/** YYYYMMDD when modeled (MySQL may return string) */
	unionStartDate: number | string | null;
	unionEndDate: number | string | null;
}

export interface PersonFamilySummary {
	focalPersonId: string;
	focalEntityId: string;
	focalDisplayName: string;
	/** From tanahpedia_person_sex when present (MALE / FEMALE). */
	focalSex: string | null;
	parents: PersonFamilyParentEdge[];
	children: PersonFamilyChildEdge[];
	spouses: PersonFamilySpouseEdge[];
	siblings: PersonFamilyRelatedPerson[];
}

/** Marker for Tanahpedia places map (OpenStreetMap; no API key). */
export interface PlaceMapMarker {
	placeId: string;
	placeName: string;
	modernName: string | null;
	lat: number;
	lng: number;
	entryUniqueName: string | null;
}
