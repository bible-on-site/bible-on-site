"use client";

import Link from "next/link";
import {
	type CSSProperties,
	Fragment,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	compareChildEdgesChronology,
	shouldApplyJacobChildChronology,
} from "@/lib/tanahpedia/person-family-chronology";
import {
	childGroupByCoParentLabel,
	focalChildCardMetaLine,
	formatUnionYyyymmdd,
	parentRoleLabel,
	parentRoleSortKey,
	partitionSiblingsForFamilyTree,
	personSexCornerMark,
	relationshipTypeLabel,
	spouseHalachicOpinionTitle,
	spousesSectionLabel,
	unionEndReasonLabel,
	unionTypeLabel,
} from "@/lib/tanahpedia/person-family-labels";
import { renderFamilyTreeCitationLine } from "@/lib/tanahpedia/tanach-citation-links";
import type {
	PersonFamilyChildEdge,
	PersonFamilyParentEdge,
	PersonFamilyRelatedPerson,
	PersonFamilySpouseEdge,
	PersonFamilySummary,
} from "@/lib/tanahpedia/types";
import styles from "./PersonFamilyTree.module.css";

type CoParentChildBucket = {
	key: string;
	coParentEntityId: string | null;
	coParentDisplayName: string | null;
	coParentUnionOrder: number | null;
	edges: PersonFamilyChildEdge[];
};

function partitionChildrenByCoParent(
	edges: PersonFamilyChildEdge[],
	edgeCmp?: (a: PersonFamilyChildEdge, b: PersonFamilyChildEdge) => number,
): CoParentChildBucket[] {
	const defaultCmp = (a: PersonFamilyChildEdge, b: PersonFamilyChildEdge) =>
		a.related.displayName.localeCompare(b.related.displayName, "he");
	const cmp = edgeCmp ?? defaultCmp;
	const m = new Map<string, PersonFamilyChildEdge[]>();
	for (const e of edges) {
		const key = e.coParentEntityId ?? "__none__";
		const list = m.get(key) ?? [];
		list.push(e);
		m.set(key, list);
	}
	const buckets: CoParentChildBucket[] = [];
	for (const [key, list] of m) {
		const first = list[0];
		buckets.push({
			key,
			coParentEntityId: first.coParentEntityId,
			coParentDisplayName: first.coParentDisplayName,
			coParentUnionOrder: first.coParentUnionOrder,
			edges: [...list].sort(cmp),
		});
	}
	buckets.sort((a, b) => {
		if (a.key === "__none__" && b.key !== "__none__") return 1;
		if (a.key !== "__none__" && b.key === "__none__") return -1;
		const ao = a.coParentUnionOrder;
		const bo = b.coParentUnionOrder;
		if (ao != null && bo != null && ao !== bo) return ao - bo;
		if (ao != null && bo == null) return -1;
		if (ao == null && bo != null) return 1;
		return (a.coParentDisplayName ?? "").localeCompare(
			b.coParentDisplayName ?? "",
			"he",
		);
	});
	return buckets;
}

function shouldShowCoParentSubtitles(buckets: CoParentChildBucket[]): boolean {
	if (buckets.length > 1) return true;
	if (buckets.length === 1 && buckets[0].key !== "__none__") return true;
	return false;
}

/** מטריצת בן-זוג+ילדים — לא כשחלופי מחייב כמה ישויות שונות באותו בלוק */
function canUseSpouseChildMatrix(units: SpouseUnit[]): boolean {
	return !units.some((u) => {
		const n = new Set(u.edges.map((e) => e.related.entityId)).size;
		return u.altGroupKey != null && n > 1;
	});
}

function buildPartnerChildColumns(
	childEdges: PersonFamilyChildEdge[],
	spouseUnits: SpouseUnit[],
	focalDisplayName: string,
): {
	columnChildren: Map<string, PersonFamilyChildEdge[]>;
	looseChildren: PersonFamilyChildEdge[];
} {
	const chronology = shouldApplyJacobChildChronology(
		focalDisplayName,
		childEdges,
	);
	const cmp = (a: PersonFamilyChildEdge, b: PersonFamilyChildEdge) =>
		chronology
			? compareChildEdgesChronology(a, b, focalDisplayName)
			: a.related.displayName.localeCompare(b.related.displayName, "he");
	const spousePartnerIds = new Set(
		spouseUnits.map((u) => u.edges[0].related.entityId),
	);
	const columnChildren = new Map<string, PersonFamilyChildEdge[]>();
	for (const id of spousePartnerIds) columnChildren.set(id, []);
	for (const c of childEdges) {
		const pid = c.coParentEntityId;
		if (!pid || !spousePartnerIds.has(pid)) continue;
		columnChildren.get(pid)?.push(c);
	}
	for (const arr of columnChildren.values()) {
		arr.sort(cmp);
	}
	const looseChildren = childEdges
		.filter((c) => {
			const pid = c.coParentEntityId;
			if (!pid) return true;
			return !spousePartnerIds.has(pid);
		})
		.sort(cmp);
	return { columnChildren, looseChildren };
}

function childEdgeCoParentOutsideSpouses(
	edge: PersonFamilyChildEdge,
	spousePartnerIds: Set<string>,
): boolean {
	return (
		edge.coParentEntityId == null ||
		!spousePartnerIds.has(edge.coParentEntityId)
	);
}

function groupByAltGroupId<T extends { altGroupId: string | null }>(
	rows: T[],
): Map<string | null, T[]> {
	const m = new Map<string | null, T[]>();
	for (const row of rows) {
		const k = row.altGroupId;
		const list = m.get(k) ?? [];
		list.push(row);
		m.set(k, list);
	}
	return m;
}

type SpouseUnit = {
	altGroupKey: string | null;
	edges: PersonFamilySpouseEdge[];
};

/** Build display units: null alt_group → one edge each; non-null → cluster by partner entity. */
function buildSpouseUnits(spouses: PersonFamilySpouseEdge[]): SpouseUnit[] {
	const units: SpouseUnit[] = [];
	const withoutAlt = spouses.filter((s) => s.altGroupId == null);
	const withAlt = spouses.filter((s) => s.altGroupId != null);

	for (const e of withoutAlt) {
		units.push({ altGroupKey: null, edges: [e] });
	}

	const byAlt = groupByAltGroupId(withAlt);
	const altKeys = [...byAlt.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return String(a).localeCompare(String(b));
	});

	for (const key of altKeys) {
		const group = byAlt.get(key) ?? [];
		const byEntity = new Map<string, PersonFamilySpouseEdge[]>();
		for (const edge of group) {
			const id = edge.related.entityId;
			const list = byEntity.get(id) ?? [];
			list.push(edge);
			byEntity.set(id, list);
		}
		for (const edges of byEntity.values()) {
			units.push({ altGroupKey: key, edges });
		}
	}

	units.sort((a, b) => {
		const minOrder = (u: SpouseUnit) =>
			Math.min(...u.edges.map((e) => e.unionOrder ?? 999));
		const d = minOrder(a) - minOrder(b);
		if (d !== 0) return d;
		return a.edges[0].related.displayName.localeCompare(
			b.edges[0].related.displayName,
			"he",
		);
	});

	return fuseMarriageAndForbiddenSpouseRows(units);
}

/**
 * איחוד שתי שורות union (נישואין + קשר פסול) לאותה בת זוג ואותו סדר —
 * גם כש־alt_group_id לא תואם בין השורות ב-DB.
 */
function fuseMarriageAndForbiddenSpouseRows(units: SpouseUnit[]): SpouseUnit[] {
	const multis = units.filter((u) => u.edges.length > 1);
	const singles = units.filter((u) => u.edges.length === 1);
	const used = new Set<number>();
	const fused: SpouseUnit[] = [];

	for (let i = 0; i < singles.length; i++) {
		if (used.has(i)) continue;
		const ea = singles[i].edges[0];
		let pairJ = -1;
		for (let j = i + 1; j < singles.length; j++) {
			if (used.has(j)) continue;
			const eb = singles[j].edges[0];
			if (ea.related.entityId !== eb.related.entityId) continue;
			if ((ea.unionOrder ?? -999) !== (eb.unionOrder ?? -999)) continue;
			const comp =
				(ea.unionType === "MARRIAGE" &&
					eb.unionType === "FORBIDDEN_WITH_GENTILE") ||
				(eb.unionType === "MARRIAGE" &&
					ea.unionType === "FORBIDDEN_WITH_GENTILE");
			if (!comp) continue;
			pairJ = j;
			break;
		}
		if (pairJ >= 0) {
			const eb = singles[pairJ].edges[0];
			fused.push({
				altGroupKey: singles[i].altGroupKey ?? singles[pairJ].altGroupKey,
				edges: [ea, eb],
			});
			used.add(i);
			used.add(pairJ);
		}
	}

	const rest: SpouseUnit[] = [];
	for (let i = 0; i < singles.length; i++) {
		if (!used.has(i)) rest.push(singles[i]);
	}

	const all = [...multis, ...fused, ...rest];
	all.sort((a, b) => {
		const minOrder = (u: SpouseUnit) =>
			Math.min(...u.edges.map((e) => e.unionOrder ?? 999));
		const d = minOrder(a) - minOrder(b);
		if (d !== 0) return d;
		return a.edges[0].related.displayName.localeCompare(
			b.edges[0].related.displayName,
			"he",
		);
	});
	return all;
}

function sortEdgesForOpinions(
	edges: PersonFamilySpouseEdge[],
): PersonFamilySpouseEdge[] {
	return [...edges].sort((a, b) => {
		const rank = (t: string) =>
			t === "MARRIAGE"
				? 0
				: t === "FORBIDDEN_WITH_GENTILE"
					? 1
					: t === "BANNED_INCEST"
						? 2
						: t === "BETROTHAL"
							? 3
							: 4;
		const dr = rank(a.unionType) - rank(b.unionType);
		if (dr !== 0) return dr;
		const ao = a.unionOrder ?? 999;
		const bo = b.unionOrder ?? 999;
		if (ao !== bo) return ao - bo;
		return a.unionType.localeCompare(b.unionType);
	});
}

function PersonNameLink({ related }: { related: PersonFamilyRelatedPerson }) {
	const label = related.entryTitle ?? related.displayName;
	if (related.entryUniqueName) {
		return (
			<Link
				href={`/tanahpedia/entry/${encodeURIComponent(related.entryUniqueName)}`}
				className={styles.personLink}
				title={label}
			>
				{label}
			</Link>
		);
	}
	return (
		<span className={styles.personUnlinked} title={related.displayName}>
			{related.displayName}
		</span>
	);
}

function citationLines(text: string | null) {
	if (!text?.trim()) return [];
	const occurrenceCounts = new Map<string, number>();
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const occurrence = (occurrenceCounts.get(line) ?? 0) + 1;
			occurrenceCounts.set(line, occurrence);
			return { key: `${line}:${occurrence}`, line };
		});
}

/** מקור מהתנ"ך / תנכפדיה מתחת לשורת טיב הקשר (שורה לכל פסקה בטקסט ה־DB) */
function citationRibbonBlock(text: string | null) {
	const lines = citationLines(text);
	if (lines.length === 0) return null;
	return (
		<div className={styles.relationRibbonCitation}>
			{lines.map(({ key, line }) => (
				<div key={key} className={styles.relationRibbonCitationLine}>
					{renderFamilyTreeCitationLine(line, styles.citationTanachLink)}
				</div>
			))}
		</div>
	);
}

/** מקור האדם עצמו (למשל פסוק הלידה) — מוצג בתוך משבצת הכרטיס, מתחת לשם */
function cardCitationBlock(text: string | null) {
	const lines = citationLines(text);
	if (lines.length === 0) return null;
	return (
		<div className={styles.cardCitation}>
			{lines.map(({ key, line }) => (
				<div key={key} className={styles.cardCitationLine}>
					{renderFamilyTreeCitationLine(line, styles.citationTanachLink)}
				</div>
			))}
		</div>
	);
}

function PersonSexMark({ sex }: { sex: string | null }) {
	const mark = personSexCornerMark(sex);
	if (!mark) return null;
	const label = sex === "MALE" ? "זכר" : sex === "FEMALE" ? "נקבה" : undefined;
	const sexClass =
		sex === "MALE"
			? styles.sexMarkMale
			: sex === "FEMALE"
				? styles.sexMarkFemale
				: "";
	return (
		<span
			className={`${styles.sexMark} ${sexClass}`}
			title={label ?? undefined}
			aria-hidden="true"
		>
			{mark}
		</span>
	);
}

function sexMarkDataAttribute(sex: string | null): "" | undefined {
	return personSexCornerMark(sex) ? "" : undefined;
}

function spouseTimelineSuffix(edge: PersonFamilySpouseEdge): string {
	const bits: string[] = [];
	const start = formatUnionYyyymmdd(edge.unionStartDate);
	const end = formatUnionYyyymmdd(edge.unionEndDate);
	if (start) bits.push(`התחלה ${start}`);
	if (edge.unionEndReason) {
		bits.push(
			`${unionEndReasonLabel(edge.unionEndReason)}${end ? ` ${end}` : ""}`,
		);
	} else if (end) {
		bits.push(`סיום ${end}`);
	}
	if (bits.length === 0) return "";
	return ` · ${bits.join(" · ")}`;
}

/** טקסט תאריכים/סיום ללא קידומת « · » — שורה נפרדת מתחת למקור הנישואין */
function spouseTimelinePlain(edge: PersonFamilySpouseEdge): string {
	const t = spouseTimelineSuffix(edge);
	return t.startsWith(" · ") ? t.slice(3).trim() : t.trim();
}

function ParentCard({ edge }: { edge: PersonFamilyParentEdge }) {
	const role = parentRoleLabel(edge.parentRole);
	const rel = relationshipTypeLabel(edge.relationshipType);
	const extra = edge.relationshipType !== "BIOLOGICAL" ? ` · ${rel}` : "";
	return (
		<div className={styles.personCardStack}>
			<div className={styles.relationRibbon}>
				<span className={styles.relationRibbonMain}>
					{role}
					{extra}
				</span>
			</div>
			<div
				className={styles.card}
				data-parent-card
				data-has-sex-mark={sexMarkDataAttribute(edge.related.sex)}
			>
				<PersonSexMark sex={edge.related.sex} />
				<PersonNameLink related={edge.related} />
				{cardCitationBlock(edge.sourceCitation)}
			</div>
		</div>
	);
}

function ParentRow({ parents }: { parents: PersonFamilyParentEdge[] }) {
	return (
		<div
			className={`${styles.row} ${styles.parentRow}`}
			data-parent-count={parents.length}
		>
			{parents.map((edge) => (
				<ParentCard
					key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}-${edge.altGroupId ?? "d"}`}
					edge={edge}
				/>
			))}
		</div>
	);
}

function ChildCard({ edge }: { edge: PersonFamilyChildEdge }) {
	const meta = focalChildCardMetaLine(edge);
	const face = (
		<div
			className={styles.card}
			data-has-sex-mark={sexMarkDataAttribute(edge.related.sex)}
		>
			<PersonSexMark sex={edge.related.sex} />
			<PersonNameLink related={edge.related} />
			{cardCitationBlock(edge.sourceCitation)}
		</div>
	);
	if (!meta) {
		return <div data-testid="family-child-card">{face}</div>;
	}
	return (
		<div className={styles.personCardStack} data-testid="family-child-card">
			<div className={styles.relationRibbon}>
				<span className={styles.relationRibbonMain}>{meta}</span>
			</div>
			{face}
		</div>
	);
}

function SpouseCard({
	edge,
	matrixSpouseCardMark,
}: {
	edge: PersonFamilySpouseEdge;
	matrixSpouseCardMark?: boolean;
}) {
	const u = unionTypeLabel(edge.unionType);
	const orderOnly = edge.unionOrder != null ? `סדר ${edge.unionOrder}` : "";
	const timelineBody = spouseTimelinePlain(edge);
	return (
		<div className={styles.personCardStack}>
			<div className={styles.relationRibbon}>
				<span className={styles.relationRibbonMain}>{u}</span>
			</div>
			{citationRibbonBlock(edge.sourceCitation)}
			{orderOnly ? (
				<div className={styles.relationRibbon}>
					<span className={styles.relationRibbonMeta}>{orderOnly}</span>
				</div>
			) : null}
			{timelineBody ? (
				<div className={styles.spouseUnionTimelineRibbon}>
					<span className={styles.relationRibbonMeta}>{timelineBody}</span>
				</div>
			) : null}
			<div
				className={styles.card}
				data-testid="family-spouse-card"
				data-matrix-spouse-card={matrixSpouseCardMark ? "" : undefined}
				data-has-sex-mark={sexMarkDataAttribute(edge.related.sex)}
			>
				<PersonSexMark sex={edge.related.sex} />
				<PersonNameLink related={edge.related} />
				{cardCitationBlock(edge.personSourceCitation)}
			</div>
		</div>
	);
}

/** Same partner, multiple union rows (e.g. נישואין / קשר פסול). */
function SpouseInterpretationsCard({
	edges,
	matrixSpouseCardMark,
}: {
	edges: PersonFamilySpouseEdge[];
	matrixSpouseCardMark?: boolean;
}) {
	const sorted = sortEdgesForOpinions(edges);
	const head = sorted[0];
	const multi = sorted.length > 1;
	return (
		<div className={styles.personCardStack}>
			<div
				className={styles.card}
				data-matrix-spouse-card={matrixSpouseCardMark ? "" : undefined}
				data-has-sex-mark={sexMarkDataAttribute(head.related.sex)}
			>
				<PersonSexMark sex={head.related.sex} />
				<PersonNameLink related={head.related} />
				{multi ? (
					<p className={styles.spouseDualOpinionNote}>
						לפי כל השיטות היא הייתה בת זוגו; נחלקים רק בטיב הקשר מול התורה.
					</p>
				) : null}
			</div>
			{sorted.map((edge, i) => {
				const orderOnly =
					edge.unionOrder != null ? `סדר ${edge.unionOrder}` : "";
				const timelineBody = spouseTimelinePlain(edge);
				return (
					<div
						key={`${edge.related.entityId}-${edge.unionType}-${edge.unionOrder ?? "x"}-${edge.altGroupId ?? "d"}-${edge.sourceCitation ?? ""}`}
						className={
							i === 0
								? styles.spouseOpinionRibbonFirst
								: styles.spouseOpinionRibbon
						}
					>
						<div className={styles.relationRibbon}>
							<span className={styles.spouseOpinionTitleInline}>
								{spouseHalachicOpinionTitle(edge.unionType)}
							</span>
							<span className={styles.relationRibbonSubRow}>
								<span className={styles.relationRibbonMain}>
									{unionTypeLabel(edge.unionType)}
								</span>
							</span>
						</div>
						{citationRibbonBlock(edge.sourceCitation)}
						{orderOnly ? (
							<div className={styles.relationRibbon}>
								<span className={styles.relationRibbonMeta}>{orderOnly}</span>
							</div>
						) : null}
						{timelineBody ? (
							<div className={styles.spouseUnionTimelineRibbon}>
								<span className={styles.relationRibbonMeta}>
									{timelineBody}
								</span>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}

function SiblingCard({ related }: { related: PersonFamilyRelatedPerson }) {
	return (
		<div className={styles.personCardStack}>
			<div
				className={styles.card}
				data-has-sex-mark={sexMarkDataAttribute(related.sex)}
			>
				<PersonSexMark sex={related.sex} />
				<PersonNameLink related={related} />
				{cardCitationBlock(related.sourceCitation ?? null)}
			</div>
		</div>
	);
}

function SiblingLabelBridge({ label }: { label: string }) {
	return (
		<div className={styles.siblingBridge}>
			<span className={styles.familyTreeSectionLabel}>{label}</span>
		</div>
	);
}

function SpouseUnitCardBlock({
	unit,
	matrixSpouseCardMark,
}: {
	unit: SpouseUnit;
	matrixSpouseCardMark?: boolean;
}) {
	const nEnt = new Set(unit.edges.map((e) => e.related.entityId)).size;
	const merged = unit.edges.length > 1 && nEnt === 1;
	const showAltLabel = unit.altGroupKey != null && nEnt > 1;

	const cards = merged ? (
		<SpouseInterpretationsCard
			edges={unit.edges}
			matrixSpouseCardMark={matrixSpouseCardMark}
		/>
	) : (
		unit.edges.map((e) => (
			<SpouseCard
				key={`${e.related.entityId}-${e.unionType}-${e.unionOrder ?? "x"}`}
				edge={e}
				matrixSpouseCardMark={matrixSpouseCardMark}
			/>
		))
	);

	if (showAltLabel) {
		return (
			<div className={styles.altGroupBlock}>
				<div className={styles.altGroupLabel}>
					<span
						className={`${styles.familyTreeSectionLabel} ${styles.familyTreeSectionLabelAlt}`}
					>
						חלופי
					</span>
				</div>
				<div className={styles.spouseClusterInner}>{cards}</div>
			</div>
		);
	}

	return <>{cards}</>;
}

function SpouseUnitNodes({
	units,
	keyPrefix,
}: {
	units: SpouseUnit[];
	keyPrefix: string;
}) {
	return units.map((unit, idx) => {
		const key =
			unit.altGroupKey ??
			`${keyPrefix}-solo-${unit.edges[0].related.entityId}-${unit.edges[0].unionType}-${idx}`;
		return (
			<Fragment key={key}>
				<SpouseUnitCardBlock unit={unit} />
			</Fragment>
		);
	});
}

/** מרווח היסטרזיס (px) שמונע ריצוד קיפול/פרישה סביב סף ההתאמה של המטריצה. */
export const SPOUSE_MATRIX_COLLAPSE_HYSTERESIS_PX = 24;

/**
 * רוחב המסך המרבי (px) שבו עץ המשפחה עובר לפריסה האנכית המוכללת: כל הקשרים
 * על ציר אנכי אחד — הורים למעלה, אחר כך המוקד, אחים, בנות זוג ולבסוף ילדים.
 */
export const FAMILY_TREE_VERTICAL_MAX_WIDTH_PX = 767;

/**
 * החלטה טהורה: האם לקפל את מטריצת בן-הזוג+ילדים לפריסה אנכית (מובייל).
 * מקפלים כאשר הרוחב הטבעי של המטריצה גדול מהרוחב הזמין במכולה — כלומר המטריצה
 * הייתה גולשת אופקית. ההחלטה תלויה בהתאמה בפועל ולא ברוחב מסך קבוע, כך שהמעבר
 * מדויק לכל מספר בנות זוג/ילדים ולכל רוחב מסך. ההיסטרזיס מונע ריצוד סביב הסף.
 */
export function shouldCollapseSpouseMatrix({
	previous,
	availableWidth,
	naturalWidth,
	hysteresisPx = SPOUSE_MATRIX_COLLAPSE_HYSTERESIS_PX,
}: {
	previous: boolean;
	availableWidth: number;
	naturalWidth: number;
	hysteresisPx?: number;
}): boolean {
	if (naturalWidth <= 0 || availableWidth <= 0) return previous;
	if (availableWidth < naturalWidth) return true;
	if (availableWidth >= naturalWidth + hysteresisPx) return false;
	return previous;
}

type MobileMatrixColumn = {
	unit: SpouseUnit;
	partnerId: string;
	kids: PersonFamilyChildEdge[];
};

/**
 * פריסת מובייל למטריצת בן-זוג+ילדים (יעקב וכד'): במקום מטריצה אופקית עם גלילה
 * צידית, כל בת זוג מוצגת מעל ילדיה בטור אנכי — כך שהכל נקרא ברוחב טלפון בלי
 * גלילה אופקית, בדומה למסילת ה-spouse-only של שמשון.
 */
function MobileMatrixStack({
	columns,
	looseChildren,
	looseLabel,
}: {
	columns: MobileMatrixColumn[];
	looseChildren: PersonFamilyChildEdge[];
	looseLabel: string;
}) {
	return (
		<div className={styles.matrixMobileStack} data-matrix-mobile="">
			{columns.map(({ unit, partnerId, kids }) => (
				<div
					key={`m-col-${partnerId}-${unit.altGroupKey ?? "d"}`}
					className={styles.matrixMobileColumn}
				>
					<div className={styles.matrixMobileSpouse}>
						<SpouseUnitCardBlock unit={unit} />
					</div>
					{kids.length > 0 ? (
						<>
							<div className={styles.matrixMobileConnector} aria-hidden />
							<div className={styles.matrixMobileChildren}>
								{kids.map((edge) => (
									<ChildCard
										key={`m-kid-${partnerId}-${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`}
										edge={edge}
									/>
								))}
							</div>
						</>
					) : null}
				</div>
			))}
			{looseChildren.length > 0 ? (
				<div key="m-col-loose" className={styles.matrixMobileColumn}>
					<div className={styles.matrixMobileLooseLabel}>
						<span className={styles.familyTreeSectionLabel}>{looseLabel}</span>
					</div>
					<div className={styles.matrixMobileChildren}>
						{looseChildren.map((edge) => (
							<ChildCard
								key={`m-loose-${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`}
								edge={edge}
							/>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function PersonFamilyTreeContent({
	summary,
}: {
	summary: PersonFamilySummary;
}) {
	const {
		focalDisplayName,
		focalSex,
		focalBirthYyyymmdd,
		parents,
		children,
		spouses,
		siblings,
	} = summary;

	const parentGroups = groupByAltGroupId(parents);
	const parentKeys = [...parentGroups.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return a.localeCompare(b);
	});

	const sortedParentsGlobal = [...parents].sort((a, b) => {
		const rk =
			parentRoleSortKey(a.parentRole) - parentRoleSortKey(b.parentRole);
		if (rk !== 0) return rk;
		return a.related.displayName.localeCompare(b.related.displayName, "he");
	});

	const sortedChildrenBase = [...children].sort((a, b) => {
		const ak = a.altGroupId ?? "";
		const bk = b.altGroupId ?? "";
		if (ak !== bk) return ak.localeCompare(bk);
		return a.related.displayName.localeCompare(b.related.displayName, "he");
	});
	const sortedChildren = shouldApplyJacobChildChronology(
		focalDisplayName,
		sortedChildrenBase,
	)
		? [...sortedChildrenBase].sort((a, b) =>
				compareChildEdgesChronology(a, b, focalDisplayName),
			)
		: sortedChildrenBase;

	const childEdgeCmp = shouldApplyJacobChildChronology(
		focalDisplayName,
		sortedChildren,
	)
		? (a: PersonFamilyChildEdge, b: PersonFamilyChildEdge) =>
				compareChildEdgesChronology(a, b, focalDisplayName)
		: undefined;

	const childGroups = groupByAltGroupId(sortedChildren);
	const childKeys = [...childGroups.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return a.localeCompare(b);
	});

	const siblingLayout = partitionSiblingsForFamilyTree(
		siblings,
		focalBirthYyyymmdd,
	);

	const spouseUnits = buildSpouseUnits(spouses);

	const spouseSectionLabel = spousesSectionLabel(focalSex);

	const matrixEligible =
		spouses.length > 0 &&
		sortedChildren.length > 0 &&
		childKeys.length === 1 &&
		childKeys[0] === null &&
		canUseSpouseChildMatrix(spouseUnits) &&
		sortedChildren.some((c) => c.coParentEntityId != null);

	const partnerColumns =
		spouses.length > 0 && sortedChildren.length > 0
			? buildPartnerChildColumns(sortedChildren, spouseUnits, focalDisplayName)
			: {
					columnChildren: new Map<string, PersonFamilyChildEdge[]>(),
					looseChildren: [] as PersonFamilyChildEdge[],
				};

	const { columnChildren, looseChildren } = matrixEligible
		? partnerColumns
		: {
				columnChildren: new Map<string, PersonFamilyChildEdge[]>(),
				looseChildren: [] as PersonFamilyChildEdge[],
			};

	/** סדר בנות הזוג לפי סדר הנישואין / union_order ב־DB, לא לפי לידת ילד ראשון */
	const orderedSpouseUnits = spouseUnits;

	const jacobChildrenSequenceLayout =
		matrixEligible &&
		shouldApplyJacobChildChronology(focalDisplayName, sortedChildren);

	const spousePartnerIdsForSeq = new Set(
		spouseUnits.map((u) => u.edges[0].related.entityId),
	);
	const jacobMappedChildren = sortedChildren.filter(
		(c) =>
			c.coParentEntityId != null &&
			spousePartnerIdsForSeq.has(c.coParentEntityId),
	);
	const jacobLooseChildren = sortedChildren.filter(
		(c) =>
			c.coParentEntityId == null ||
			!spousePartnerIdsForSeq.has(c.coParentEntityId),
	);

	const showJacobLooseTopCell =
		jacobChildrenSequenceLayout && jacobLooseChildren.length > 0;

	const jacobGlobalChildTimeline = jacobChildrenSequenceLayout
		? [
				...[...jacobMappedChildren].sort((a, b) =>
					compareChildEdgesChronology(a, b, focalDisplayName),
				),
				...[...jacobLooseChildren].sort((a, b) =>
					compareChildEdgesChronology(a, b, focalDisplayName),
				),
			]
		: [];

	const matrixColCount = jacobChildrenSequenceLayout
		? orderedSpouseUnits.length + (showJacobLooseTopCell ? 1 : 0)
		: looseChildren.length > 0
			? orderedSpouseUnits.length + 1
			: orderedSpouseUnits.length;

	// שורת נישואין אחידה: קו אנכי מהמוקד יורד עד קו אופקי בגובה אמצע הכרטיסים.
	// מוצגת גם במטריצה עם ילדים (כמו יעקב) וגם כשאין ילדים (כמו שמשון) — אותם
	// כללי CSS בדיוק, בלי דיברגנציה. spouseChildrenMatrixOuter + matrixSpouseRow.
	const showSpouseMarriageRow = matrixEligible || orderedSpouseUnits.length > 1;

	// פריסה אנכית מוכללת למסכים צרים: במקום לתקן כל שכבה בנפרד, מתחת לסף אחד
	// כל העץ עובר לציר אנכי יחיד — הורים, מוקד, אחים, בנות זוג, ילדים — עם
	// תווית מעל כל קבוצה וקו שדרה אחד. מעל הסף נשמרת פריסת הדסקטופ, ומנגנוני
	// הקיפול תלויי-התוכן ממשיכים להגן על שכבות רחבות (מטריצה/מסילת בנות זוג).
	const [isNarrow, setIsNarrow] = useState(false);

	useLayoutEffect(() => {
		if (
			typeof window === "undefined" ||
			typeof window.matchMedia !== "function"
		) {
			return;
		}
		const mq = window.matchMedia(
			`(max-width: ${FAMILY_TREE_VERTICAL_MAX_WIDTH_PX}px)`,
		);
		const apply = () => setIsNarrow(mq.matches);
		apply();
		if (typeof mq.addEventListener !== "function") return;
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, []);

	const matrixSpouseRowRef = useRef<HTMLDivElement>(null);
	const [matrixSpouseMidPx, setMatrixSpouseMidPx] = useState(36);
	const [matrixMarriageLineYpx, setMatrixMarriageLineYpx] = useState(36);

	useLayoutEffect(() => {
		// בפריסה האנכית שורת הנישואין המדודה לא מרונדרת כלל; המדידה רלוונטית רק
		// לדסקטופ, וההסתמכות על isNarrow מחברת מחדש את ה-ResizeObserver לאלמנט
		// החדש כשחוזרים לפריסת הדסקטופ.
		if (isNarrow) return;
		const el = matrixSpouseRowRef.current;
		if (!el || !showSpouseMarriageRow) return;
		const measure = () => {
			const rowRect = el.getBoundingClientRect();
			const rowH = rowRect.height;
			let lineCenterY = rowH / 2;
			const cards = el.querySelectorAll("[data-matrix-spouse-card]");
			const cardCenters: Array<{ x: number; y: number }> = [];
			let firstCardCenterX = 0;
			let lastCardCenterX = rowRect.width;
			for (const node of cards) {
				const r = (node as HTMLElement).getBoundingClientRect();
				const mid = r.top - rowRect.top + r.height / 2;
				if (mid > lineCenterY) lineCenterY = mid;
				const cx = r.left - rowRect.left + r.width / 2;
				cardCenters.push({ x: cx, y: mid });
				if (cx < lastCardCenterX) lastCardCenterX = cx;
				if (cx > firstCardCenterX) firstCardCenterX = cx;
			}
			const isVertical =
				cardCenters.length > 1 &&
				Math.max(...cardCenters.map(({ x }) => x)) -
					Math.min(...cardCenters.map(({ x }) => x)) <
					2;
			if (isVertical) {
				lineCenterY = Math.min(...cardCenters.map(({ y }) => y));
			}
			setMatrixMarriageLineYpx(Math.max(8, Math.round(lineCenterY)));
			setMatrixSpouseMidPx(Math.max(12, Math.round(rowH - lineCenterY + 8)));
			el.style.setProperty(
				"--matrix-line-start-y",
				`${Math.round(Math.min(...cardCenters.map(({ y }) => y)))}px`,
			);
			el.style.setProperty(
				"--matrix-line-end-y",
				`${Math.round(Math.max(...cardCenters.map(({ y }) => y)))}px`,
			);
			// Inset the horizontal spouse line to end near the outermost card centers
			const insetRight = Math.max(
				4,
				Math.round(rowRect.width - firstCardCenterX - 4),
			);
			const insetLeft = Math.max(4, Math.round(lastCardCenterX - 4));
			el.style.setProperty("--matrix-line-inset-left", `${insetLeft}px`);
			el.style.setProperty("--matrix-line-inset-right", `${insetRight}px`);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [showSpouseMarriageRow, isNarrow]);

	const spouseTierRef = useRef<HTMLDivElement>(null);
	const matrixOuterRef = useRef<HTMLDivElement>(null);
	const naturalMatrixWidthRef = useRef(0);
	const [collapseMatrix, setCollapseMatrix] = useState(false);

	// מעבר תלוי-תוכן: מודדים אם מטריצת הדסקטופ נכנסת במכולה; אם היא גולשת אופקית
	// מקפלים אותה לפריסה אנכית (MobileMatrixStack). את הרוחב הטבעי שומרים רק
	// ברגע הגלישה האמיתית — לא בכל מדידה — כי עם min-width:100% המדידה במסך רחב
	// מחזירה את רוחב המכולה עצמה והייתה מנפחת את המטמון לצמיתות (ראצ'ט).
	useLayoutEffect(() => {
		if (!matrixEligible || isNarrow) {
			naturalMatrixWidthRef.current = 0;
			setCollapseMatrix(false);
			return;
		}
		const tier = spouseTierRef.current;
		if (!tier) return;
		const evaluate = () => {
			setCollapseMatrix((previous) => {
				if (!previous) {
					const outer = matrixOuterRef.current;
					if (!outer) return previous;
					const next = shouldCollapseSpouseMatrix({
						previous,
						availableWidth: tier.clientWidth,
						naturalWidth: outer.scrollWidth,
					});
					if (next) naturalMatrixWidthRef.current = outer.scrollWidth;
					return next;
				}
				return shouldCollapseSpouseMatrix({
					previous,
					availableWidth: tier.clientWidth,
					naturalWidth: naturalMatrixWidthRef.current,
				});
			});
		};
		evaluate();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(evaluate);
		ro.observe(tier);
		return () => ro.disconnect();
	}, [matrixEligible, isNarrow]);

	// מסילת בנות-זוג בלבד (שמשון וכד' — בלי ילדים ממופים). אותה לוגיקה תלוית-תוכן
	// כמו במטריצה: אם המסילה האופקית גולשת מהמכולה מקפלים אותה לטור אנכי. כך זה
	// מדויק גם בטווח 601–950px שאין לו @media, ולא רק מתחת ל-600.
	const spouseOnlyRail = !matrixEligible && orderedSpouseUnits.length > 1;
	const naturalSpouseOnlyWidthRef = useRef(0);
	const [collapseSpouseOnly, setCollapseSpouseOnly] = useState(false);

	useLayoutEffect(() => {
		if (!spouseOnlyRail || isNarrow) {
			naturalSpouseOnlyWidthRef.current = 0;
			setCollapseSpouseOnly(false);
			return;
		}
		const tier = spouseTierRef.current;
		if (!tier) return;
		const evaluate = () => {
			setCollapseSpouseOnly((previous) => {
				if (!previous) {
					const next = shouldCollapseSpouseMatrix({
						previous,
						availableWidth: tier.clientWidth,
						naturalWidth: tier.scrollWidth,
					});
					if (next) naturalSpouseOnlyWidthRef.current = tier.scrollWidth;
					return next;
				}
				return shouldCollapseSpouseMatrix({
					previous,
					availableWidth: tier.clientWidth,
					naturalWidth: naturalSpouseOnlyWidthRef.current,
				});
			});
		};
		evaluate();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(evaluate);
		ro.observe(tier);
		return () => ro.disconnect();
	}, [spouseOnlyRail, isNarrow]);

	/* פריסת מובייל למטריצה: כל בת זוג + ילדיה בטור, לפי סדר הכרונולוגיה של יעקב
	 * או לפי עמודות בת-הזוג במטריצה הרגילה. נשמר סדר הילדים כמו בדסקטופ. */
	const mobileMatrixColumns: MobileMatrixColumn[] = matrixEligible
		? orderedSpouseUnits.map((unit) => {
				const partnerId = unit.edges[0].related.entityId;
				const kids = jacobChildrenSequenceLayout
					? jacobGlobalChildTimeline.filter(
							(c) => c.coParentEntityId === partnerId,
						)
					: (columnChildren.get(partnerId) ?? []);
				return { unit, partnerId, kids };
			})
		: [];

	const mobileMatrixLooseChildren: PersonFamilyChildEdge[] = matrixEligible
		? jacobChildrenSequenceLayout
			? jacobGlobalChildTimeline.filter(
					(c) =>
						c.coParentEntityId == null ||
						!spousePartnerIdsForSeq.has(c.coParentEntityId),
				)
			: looseChildren
		: [];

	const parentsRows =
		parentKeys.length <= 1 && parentKeys[0] === null ? (
			<ParentRow parents={sortedParentsGlobal} />
		) : (
			parentKeys.map((key) => {
				const group = parentGroups.get(key) ?? [];
				const sorted = [...group].sort((a, b) => {
					const rk =
						parentRoleSortKey(a.parentRole) - parentRoleSortKey(b.parentRole);
					if (rk !== 0) return rk;
					return a.related.displayName.localeCompare(
						b.related.displayName,
						"he",
					);
				});
				return (
					<div key={key ?? "default"} className={styles.altGroupBlock}>
						{key !== null ? (
							<div className={styles.altGroupLabel}>
								<span
									className={`${styles.familyTreeSectionLabel} ${styles.familyTreeSectionLabelAlt}`}
								>
									חלופי
								</span>
							</div>
						) : null}
						<ParentRow parents={sorted} />
					</div>
				);
			})
		);

	// The focal person's own source: distinct citations from their child-side parent rows.
	const focalSourceCitation =
		[
			...new Set(
				parents
					.map((p) => p.sourceCitation?.trim())
					.filter((c): c is string => Boolean(c)),
			),
		].join("\n") || null;

	const focalCardNode = (
		<div
			className={styles.cardFocal}
			data-has-sex-mark={sexMarkDataAttribute(focalSex)}
		>
			<PersonSexMark sex={focalSex} />
			<span className={styles.personUnlinked}>{focalDisplayName}</span>
			{cardCitationBlock(focalSourceCitation)}
		</div>
	);

	const nonMatrixChildrenBlocks =
		sortedChildren.length > 0 && !matrixEligible
			? childKeys.map((key) => {
					const group = childGroups.get(key) ?? [];
					const sortedGroup = [...group].sort((a, b) =>
						a.related.displayName.localeCompare(b.related.displayName, "he"),
					);
					const buckets = partitionChildrenByCoParent(
						sortedGroup,
						childEdgeCmp,
					);
					const showCoSub = shouldShowCoParentSubtitles(buckets);
					return (
						<div key={key ?? "default"} className={styles.altGroupBlock}>
							{key !== null ? (
								<div className={styles.altGroupLabel}>
									<span
										className={`${styles.familyTreeSectionLabel} ${styles.familyTreeSectionLabelAlt}`}
									>
										חלופי
									</span>
								</div>
							) : null}
							{buckets.map((bucket) => (
								<Fragment key={bucket.key}>
									{showCoSub ? (
										<div className={styles.coParentChildLabel}>
											<span className={styles.familyTreeSectionLabel}>
												{childGroupByCoParentLabel(
													bucket.coParentDisplayName,
													bucket.key !== "__none__",
												)}
											</span>
										</div>
									) : null}
									<div className={styles.row}>
										{bucket.edges.map((edge) => (
											<ChildCard
												key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}-${key ?? "d"}-${bucket.key}`}
												edge={edge}
											/>
										))}
									</div>
								</Fragment>
							))}
						</div>
					);
				})
			: null;

	// פריסה אנכית מוכללת (מסכים צרים): כל הקשרים על ציר אנכי אחד — הורים למעלה,
	// אחר כך המוקד, אחים, בנות זוג ולבסוף ילדים. תווית מעל כל קבוצה וקו שדרה
	// יחיד — בלי קווי עזר אופקיים שמניחים שורה רחבה (ולכן בלי קווים יתומים/כפולים).
	if (isNarrow) {
		const siblingSections = [
			{
				key: "pre",
				label: siblingLayout.preLabel,
				cluster: siblingLayout.preCluster,
			},
			{
				key: "post",
				label: siblingLayout.postLabel,
				cluster: siblingLayout.postCluster,
			},
		].filter((s) => s.cluster.length > 0);
		return (
			<section
				className={styles.section}
				aria-labelledby="person-family-heading"
				data-family-vertical=""
			>
				<h2 id="person-family-heading" className={styles.title}>
					משפחה
				</h2>
				<div className={styles.verticalAxis}>
					{parents.length > 0 ? (
						<>
							<div className={styles.verticalTierLabel}>
								<span className={styles.familyTreeSectionLabel}>הורים</span>
							</div>
							<div className={styles.verticalParents}>{parentsRows}</div>
							<div className={styles.verticalConnector} aria-hidden />
						</>
					) : null}
					<div className={styles.verticalFocal}>{focalCardNode}</div>
					{siblingSections.map((s) => (
						<Fragment key={`v-sib-${s.key}`}>
							<div className={styles.verticalConnector} aria-hidden />
							{s.label ? (
								<div className={styles.verticalTierLabel}>
									<span className={styles.familyTreeSectionLabel}>
										{s.label}
									</span>
								</div>
							) : null}
							<div className={styles.verticalSiblingGroup}>
								{s.cluster.map((rel) => (
									<SiblingCard key={`v-${rel.entityId}`} related={rel} />
								))}
							</div>
						</Fragment>
					))}
					{spouses.length > 0 ? (
						<>
							<div className={styles.verticalConnector} aria-hidden />
							<div className={styles.verticalTierLabel}>
								<span className={styles.familyTreeSectionLabel}>
									{spouseSectionLabel}
								</span>
							</div>
							{matrixEligible ? (
								<MobileMatrixStack
									columns={mobileMatrixColumns}
									looseChildren={mobileMatrixLooseChildren}
									looseLabel="ילדים ללא מיפוי מלא לבת זוג בגרף"
								/>
							) : (
								<div
									className={styles.verticalSpouseStack}
									data-spouse-rail="collapsed"
								>
									<SpouseUnitNodes
										units={orderedSpouseUnits}
										keyPrefix="v-sp"
									/>
								</div>
							)}
						</>
					) : null}
					{nonMatrixChildrenBlocks ? (
						<>
							<div className={styles.verticalConnector} aria-hidden />
							<div className={styles.verticalTierLabel}>
								<span className={styles.familyTreeSectionLabel}>ילדים</span>
							</div>
							<div className={styles.verticalChildren}>
								{nonMatrixChildrenBlocks}
							</div>
						</>
					) : null}
				</div>
			</section>
		);
	}

	return (
		<section className={styles.section} aria-labelledby="person-family-heading">
			<h2 id="person-family-heading" className={styles.title}>
				משפחה
			</h2>

			{parents.length > 0 ? (
				<>
					{parentsRows}
					<div className={styles.parentConnectorStack} aria-hidden>
						<div className={styles.parentConnectorDown} />
					</div>
					<div className={styles.tierLabelParentsAboveArm}>
						<span className={styles.familyTreeSectionLabel}>הורים</span>
					</div>
				</>
			) : null}

			{/* שורת מוקד ± אחים; לייבלים בין המוקד לבין כל קבוצת אחים */}
			<div className={styles.subjectGenerationGrid}>
				<div className={styles.siblingFocalFullSpan}>
					<div className={styles.siblingFocalRowGrid}>
						<div className={styles.siblingGridPre}>
							{siblings.length > 0 && siblingLayout.preCluster.length > 0 ? (
								<div
									className={`${styles.siblingCluster} ${styles.siblingClusterInRow}`}
								>
									{siblingLayout.preCluster.map((s) => (
										<SiblingCard key={s.entityId} related={s} />
									))}
								</div>
							) : null}
							{siblings.length > 0 && siblingLayout.preCluster.length > 0 ? (
								<div className={styles.siblingTieStretch} aria-hidden />
							) : null}
							{siblingLayout.preLabel ? (
								<SiblingLabelBridge label={siblingLayout.preLabel} />
							) : null}
							{siblingLayout.preLabel ? (
								<div className={styles.siblingTieCompact} aria-hidden />
							) : null}
						</div>
						<div className={styles.siblingGridFocal}>
							{parents.length > 0 || spouses.length > 0 ? (
								<div className={styles.focalSpineRod} aria-hidden />
							) : null}
							<div className={styles.focalWrap}>{focalCardNode}</div>
						</div>
						<div className={styles.siblingGridPost}>
							{siblingLayout.postLabel ? (
								<div className={styles.siblingTieCompact} aria-hidden />
							) : null}
							{siblingLayout.postLabel ? (
								<SiblingLabelBridge label={siblingLayout.postLabel} />
							) : null}
							{siblings.length > 0 && siblingLayout.postCluster.length > 0 ? (
								<div className={styles.siblingTieStretch} aria-hidden />
							) : null}
							{siblings.length > 0 && siblingLayout.postCluster.length > 0 ? (
								<div
									className={`${styles.siblingCluster} ${styles.siblingClusterInRow}`}
								>
									{siblingLayout.postCluster.map((s) => (
										<SiblingCard key={s.entityId} related={s} />
									))}
								</div>
							) : null}
						</div>
					</div>
				</div>

				{spouses.length > 0 ? (
					<>
						<div className={styles.spouseBridgeCenter}>
							<div className={styles.spouseConnectorBridge}>
								<div className={styles.spouseConnectorStem} aria-hidden />
								<span
									className={`${styles.familyTreeSectionLabel} ${styles.spouseConnectorLabel}`}
								>
									{spouseSectionLabel}
								</span>
							</div>
						</div>
						<div
							ref={spouseTierRef}
							className={`${styles.spouseTierFullWidth} ${!matrixEligible && orderedSpouseUnits.length > 1 ? styles.spouseTierSpouseOnly : ""}`}
							data-spouse-layout={
								matrixEligible
									? "matrix"
									: orderedSpouseUnits.length > 1
										? "spouse-only"
										: "cards"
							}
						>
							{matrixEligible ? (
								collapseMatrix ? (
									<MobileMatrixStack
										columns={mobileMatrixColumns}
										looseChildren={mobileMatrixLooseChildren}
										looseLabel="ילדים ללא מיפוי מלא לבת זוג בגרף"
									/>
								) : (
								<div
									ref={matrixOuterRef}
									className={styles.spouseChildrenMatrixOuter}
									style={
										{
											"--matrix-spouse-mid-px": `${matrixSpouseMidPx}px`,
											"--matrix-marriage-line-y": `${matrixMarriageLineYpx}px`,
										} as CSSProperties
									}
								>
									<div
										ref={matrixSpouseRowRef}
										className={styles.matrixSpouseRow}
										style={
											{
												"--matrix-column-count": matrixColCount,
											} as CSSProperties
										}
									>
										{orderedSpouseUnits.map((unit) => (
											<div
												key={`sp-top-${unit.edges[0].related.entityId}-${unit.altGroupKey ?? "d"}`}
												className={styles.matrixSpouseCell}
											>
												<SpouseUnitCardBlock unit={unit} matrixSpouseCardMark />
											</div>
										))}
										{showJacobLooseTopCell ||
										(!jacobChildrenSequenceLayout &&
											looseChildren.length > 0) ? (
											<div
												key="sp-top-loose"
												className={styles.matrixSpouseCell}
											>
												<div
													className={styles.marriageColumnSpousePlaceholder}
													aria-hidden
												>
													<span className={styles.marriageColumnLooseTitle}>
														אחר
													</span>
												</div>
											</div>
										) : null}
									</div>

									{jacobChildrenSequenceLayout ? (
										<div className={styles.jacobSwimlaneOuter}>
											<div className={styles.matrixChildrenTierLabel}>
												<span className={styles.familyTreeSectionLabel}>
													ילדים
												</span>
											</div>
											<div
												className={styles.jacobSwimlaneFlat}
												style={{
													gridTemplateColumns: `repeat(${matrixColCount}, minmax(128px, 1fr))`,
												}}
											>
												{orderedSpouseUnits.map((unit, colIdx) => (
													<div
														key={`trunk-${unit.edges[0].related.entityId}`}
														className={styles.jacobSwimlaneTrunk}
														style={{
															gridColumn: colIdx + 1,
															gridRow: `1 / ${jacobGlobalChildTimeline.length + 1}`,
														}}
														aria-hidden
													/>
												))}
												{showJacobLooseTopCell ? (
													<div
														className={styles.jacobSwimlaneTrunk}
														style={{
															gridColumn: orderedSpouseUnits.length + 1,
															gridRow: `1 / ${jacobGlobalChildTimeline.length + 1}`,
														}}
														aria-hidden
													/>
												) : null}
												{jacobGlobalChildTimeline.flatMap((child, rowIdx) => {
													const rowNumber = rowIdx + 1;
													const rowKey = `${child.related.entityId}-${child.parentRole}-${child.relationshipType}-${child.coParentEntityId ?? "loose"}`;
													return [
														...orderedSpouseUnits.map((unit, colIdx) => {
															const pid = unit.edges[0].related.entityId;
															const isMatch = child.coParentEntityId === pid;
															return (
																<div
																	key={`swim-${pid}-${rowKey}`}
																	className={
																		isMatch
																			? styles.jacobSwimlaneCell
																			: styles.jacobSwimlaneCellEmpty
																	}
																	style={{
																		gridColumn: colIdx + 1,
																		gridRow: rowNumber,
																	}}
																>
																	{isMatch ? <ChildCard edge={child} /> : null}
																</div>
															);
														}),
														...(showJacobLooseTopCell
															? [
																	(() => {
																		const isLoose =
																			childEdgeCoParentOutsideSpouses(
																				child,
																				spousePartnerIdsForSeq,
																			);
																		return (
																			<div
																				key={`swim-loose-${rowKey}`}
																				className={
																					isLoose
																						? styles.jacobSwimlaneCell
																						: styles.jacobSwimlaneCellEmpty
																				}
																				style={{
																					gridColumn:
																						orderedSpouseUnits.length + 1,
																					gridRow: rowNumber,
																				}}
																			>
																				{isLoose ? (
																					<ChildCard edge={child} />
																				) : null}
																			</div>
																		);
																	})(),
																]
															: []),
													];
												})}
											</div>
										</div>
									) : (
										<div
											className={styles.matrixBelowSpouses}
											style={{
												gridTemplateColumns: `repeat(${matrixColCount}, minmax(128px, 1fr))`,
											}}
										>
											<div className={styles.matrixChildrenTierLabel}>
												<span className={styles.familyTreeSectionLabel}>
													ילדים
												</span>
											</div>

											{orderedSpouseUnits.map((unit, idx) => {
												const partnerEntityId = unit.edges[0].related.entityId;
												const partnerName = unit.edges[0].related.displayName;
												const colKey = `${partnerEntityId}-m-${idx}`;
												const kids = columnChildren.get(partnerEntityId) ?? [];
												return (
													<fieldset
														key={`kids-${colKey}`}
														className={styles.matrixKidsCell}
													>
														<legend className={styles.marriageColumnLegend}>
															{`ילדים מ־${partnerName}`}
														</legend>
														<div
															className={styles.marriageColumnTrunk}
															aria-hidden
														>
															<div className={styles.marriageColumnLine} />
														</div>
														<div className={styles.marriageColumnChildren}>
															{kids.map((edge) => (
																<ChildCard
																	key={`${colKey}-${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`}
																	edge={edge}
																/>
															))}
														</div>
													</fieldset>
												);
											})}
											{looseChildren.length > 0 ? (
												<fieldset
													key="kids-loose"
													className={styles.matrixKidsCell}
												>
													<legend className={styles.marriageColumnLegend}>
														ילדים ללא מיפוי מלא לבת זוג בגרף
													</legend>
													<div
														className={styles.marriageColumnTrunk}
														aria-hidden
													>
														<div className={styles.marriageColumnLine} />
													</div>
													<div className={styles.marriageColumnChildren}>
														{looseChildren.map((edge) => (
															<ChildCard
																key={`loose-${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`}
																edge={edge}
															/>
														))}
													</div>
												</fieldset>
											) : null}
										</div>
									)}
								</div>
								)
							) : orderedSpouseUnits.length > 1 ? (
								// כמה בנות זוג ללא ילדים ממופים (למשל שמשון): אותה שורת
								// נישואין כמו יעקב — קו אנכי מהמוקד יורד עד קו אופקי בגובה
								// אמצע הכרטיסים, רק בלי שורת הילדים שמתחת. כשהמסילה גולשת
								// מהמכולה (601–950px וכו') מקפלים לטור אנכי דרך spouseOnlyCollapsed.
								<div
									className={`${styles.spouseChildrenMatrixOuter} ${styles.spouseOnlyMatrix}${collapseSpouseOnly ? ` ${styles.spouseOnlyCollapsed}` : ""}`}
									data-spouse-rail={collapseSpouseOnly ? "collapsed" : "rail"}
									style={
										{
											"--matrix-spouse-mid-px": `${matrixSpouseMidPx}px`,
											"--matrix-marriage-line-y": `${matrixMarriageLineYpx}px`,
										} as CSSProperties
									}
								>
									<div
										ref={matrixSpouseRowRef}
										className={styles.matrixSpouseRow}
										style={
											{
												"--matrix-column-count": matrixColCount,
											} as CSSProperties
										}
									>
										{orderedSpouseUnits.map((unit) => (
											<div
												key={`sp-only-${unit.edges
													.map(
														(edge) =>
															`${edge.related.entityId}-${edge.unionType}-${edge.unionOrder ?? "x"}-${edge.altGroupId ?? "d"}`,
													)
													.join("_")}`}
												className={styles.matrixSpouseCell}
											>
												<SpouseUnitCardBlock unit={unit} matrixSpouseCardMark />
											</div>
										))}
									</div>
								</div>
							) : (
								<div className={styles.spouseTierCards}>
									<SpouseUnitNodes units={orderedSpouseUnits} keyPrefix="sp" />
								</div>
							)}
						</div>
					</>
				) : null}
			</div>

			{nonMatrixChildrenBlocks ? (
				<>
					<div className={styles.connector} aria-hidden />
					<div className={styles.tierLabel}>
						<span className={styles.familyTreeSectionLabel}>ילדים</span>
					</div>
					{nonMatrixChildrenBlocks}
				</>
			) : null}
		</section>
	);
}

export function PersonFamilyTree({
	summary,
}: {
	summary: PersonFamilySummary;
}) {
	const hasAny =
		summary.parents.length > 0 ||
		summary.children.length > 0 ||
		summary.spouses.length > 0 ||
		summary.siblings.length > 0;
	if (!hasAny) return null;
	return <PersonFamilyTreeContent summary={summary} />;
}
