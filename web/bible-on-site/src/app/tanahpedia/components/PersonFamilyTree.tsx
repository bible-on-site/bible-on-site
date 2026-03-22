import { Fragment } from "react";
import Link from "next/link";
import type {
	PersonFamilyChildEdge,
	PersonFamilyParentEdge,
	PersonFamilyRelatedPerson,
	PersonFamilySpouseEdge,
	PersonFamilySummary,
} from "@/lib/tanahpedia/types";
import {
	formatUnionYyyymmdd,
	parentRoleLabel,
	parentRoleSortKey,
	relationshipTypeLabel,
	spouseHalachicOpinionTitle,
	spousesSectionLabel,
	unionEndReasonLabel,
	unionTypeLabel,
} from "@/lib/tanahpedia/person-family-labels";
import styles from "./PersonFamilyTree.module.css";

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

type SpouseUnit = { altGroupKey: string | null; edges: PersonFamilySpouseEdge[] };

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

function sortEdgesForOpinions(edges: PersonFamilySpouseEdge[]): PersonFamilySpouseEdge[] {
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
			>
				{label}
			</Link>
		);
	}
	return <span className={styles.personUnlinked}>{related.displayName}</span>;
}

function citationLine(text: string | null) {
	if (!text) return null;
	return <span className={styles.citation}>{text}</span>;
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

function ParentCard({ edge }: { edge: PersonFamilyParentEdge }) {
	const role = parentRoleLabel(edge.parentRole);
	const rel = relationshipTypeLabel(edge.relationshipType);
	const extra = edge.relationshipType !== "BIOLOGICAL" ? ` · ${rel}` : "";
	return (
		<div className={styles.card}>
			<PersonNameLink related={edge.related} />
			<span className={styles.meta}>
				{role}
				{extra}
			</span>
			{citationLine(edge.sourceCitation)}
		</div>
	);
}

function ChildCard({ edge }: { edge: PersonFamilyChildEdge }) {
	const role = parentRoleLabel(edge.parentRole);
	const rel = relationshipTypeLabel(edge.relationshipType);
	const extra = edge.relationshipType !== "BIOLOGICAL" ? ` · ${rel}` : "";
	return (
		<div className={styles.card}>
			<PersonNameLink related={edge.related} />
			<span className={styles.meta}>
				{role}
				{extra}
			</span>
			{citationLine(edge.sourceCitation)}
		</div>
	);
}

function SpouseCard({ edge }: { edge: PersonFamilySpouseEdge }) {
	const u = unionTypeLabel(edge.unionType);
	const order = edge.unionOrder != null ? ` · סדר ${edge.unionOrder}` : "";
	const timeline = spouseTimelineSuffix(edge);
	return (
		<div className={styles.card}>
			<PersonNameLink related={edge.related} />
			<span className={styles.meta}>
				{u}
				{order}
				{timeline}
			</span>
			{citationLine(edge.sourceCitation)}
		</div>
	);
}

/** Same partner, multiple union rows (e.g. נישואין / קשר פסול). */
function SpouseInterpretationsCard({ edges }: { edges: PersonFamilySpouseEdge[] }) {
	const sorted = sortEdgesForOpinions(edges);
	const head = sorted[0];
	const multi = sorted.length > 1;
	return (
		<div className={styles.card}>
			<PersonNameLink related={head.related} />
			{multi ? (
				<p className={styles.spouseDualOpinionNote}>
					לפי כל השיטות היא הייתה בת זוגו; נחלקים רק בטיב הקשר מול התורה.
				</p>
			) : null}
			{sorted.map((edge, i) => (
				<div
					key={`${edge.unionType}-${edge.unionOrder ?? "x"}-${i}`}
					className={i === 0 ? styles.spouseOpinionFirst : styles.spouseOpinion}
				>
					<span className={styles.spouseOpinionTitle}>
						{spouseHalachicOpinionTitle(edge.unionType)}
					</span>
					<span className={styles.meta}>
						{unionTypeLabel(edge.unionType)}
						{edge.unionOrder != null ? ` · סדר ${edge.unionOrder}` : ""}
						{spouseTimelineSuffix(edge)}
					</span>
					{citationLine(edge.sourceCitation)}
				</div>
			))}
		</div>
	);
}

function SiblingCard({ related }: { related: PersonFamilyRelatedPerson }) {
	return (
		<div className={styles.card}>
			<PersonNameLink related={related} />
		</div>
	);
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
		const nEnt = new Set(unit.edges.map((e) => e.related.entityId)).size;
		const merged = unit.edges.length > 1 && nEnt === 1;
		const showAltLabel = unit.altGroupKey != null && nEnt > 1;

		const cards = merged ? (
			<SpouseInterpretationsCard edges={unit.edges} />
		) : (
			unit.edges.map((e) => (
				<SpouseCard
					key={`${e.related.entityId}-${e.unionType}-${e.unionOrder ?? "x"}`}
					edge={e}
				/>
			))
		);

		if (showAltLabel) {
			return (
				<div key={key} className={styles.altGroupBlock}>
					<div className={styles.altGroupLabel}>חלופי</div>
					<div className={styles.spouseClusterInner}>{cards}</div>
				</div>
			);
		}

		return <Fragment key={key}>{cards}</Fragment>;
	});
}

export function PersonFamilyTree({ summary }: { summary: PersonFamilySummary }) {
	const {
		focalDisplayName,
		focalSex,
		parents,
		children,
		spouses,
		siblings,
	} = summary;

	const hasAny =
		parents.length > 0 ||
		children.length > 0 ||
		spouses.length > 0 ||
		siblings.length > 0;

	if (!hasAny) return null;

	const parentGroups = groupByAltGroupId(parents);
	const parentKeys = [...parentGroups.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return a.localeCompare(b);
	});

	const sortedParentsGlobal = [...parents].sort((a, b) => {
		const rk = parentRoleSortKey(a.parentRole) - parentRoleSortKey(b.parentRole);
		if (rk !== 0) return rk;
		return a.related.displayName.localeCompare(b.related.displayName, "he");
	});

	const sortedChildren = [...children].sort((a, b) => {
		const ak = a.altGroupId ?? "";
		const bk = b.altGroupId ?? "";
		if (ak !== bk) return ak.localeCompare(bk);
		return a.related.displayName.localeCompare(b.related.displayName, "he");
	});

	const childGroups = groupByAltGroupId(sortedChildren);
	const childKeys = [...childGroups.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return a.localeCompare(b);
	});

	const sortedSiblings = [...siblings].sort((a, b) =>
		a.displayName.localeCompare(b.displayName, "he"),
	);
	const siblingSplitMid = Math.ceil(sortedSiblings.length / 2);
	const siblingsBeforeFocal = sortedSiblings.slice(0, siblingSplitMid);
	const siblingsAfterFocal = sortedSiblings.slice(siblingSplitMid);

	const spouseUnits = buildSpouseUnits(spouses);

	const spouseSectionLabel = spousesSectionLabel(focalSex);

	return (
		<section className={styles.section} aria-labelledby="person-family-heading">
			<h2 id="person-family-heading" className={styles.title}>
				משפחה
			</h2>

			{parents.length > 0 ? (
				<>
					<p className={styles.tierLabel}>הורים</p>
					{parentKeys.length <= 1 && parentKeys[0] === null ? (
						<div className={styles.row}>
							{sortedParentsGlobal.map((edge) => (
								<ParentCard
									key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`}
									edge={edge}
								/>
							))}
						</div>
					) : (
						parentKeys.map((key) => {
							const group = parentGroups.get(key) ?? [];
							const sorted = [...group].sort((a, b) => {
								const rk =
									parentRoleSortKey(a.parentRole) -
									parentRoleSortKey(b.parentRole);
								if (rk !== 0) return rk;
								return a.related.displayName.localeCompare(
									b.related.displayName,
									"he",
								);
							});
							return (
								<div key={key ?? "default"} className={styles.altGroupBlock}>
									{key !== null ? (
										<div className={styles.altGroupLabel}>חלופי</div>
									) : null}
									<div className={styles.row}>
										{sorted.map((edge) => (
											<ParentCard
												key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}-${key ?? "d"}`}
												edge={edge}
											/>
										))}
									</div>
								</div>
							);
						})
					)}
					<div className={styles.connector} aria-hidden />
				</>
			) : null}

			{/* נשוא הערך + אחים באותה רמה; מתחת — קו עם תווית בני/בנות זוג ואז כרטיסי זיווג */}
			<div className={styles.subjectGenerationGrid}>
				<div className={styles.siblingSidePreFocal}>
					{siblingsBeforeFocal.map((s) => (
						<SiblingCard key={s.entityId} related={s} />
					))}
				</div>
				<div className={styles.focalWrap}>
					<div className={styles.cardFocal}>
						<span className={styles.personUnlinked}>{focalDisplayName}</span>
					</div>
				</div>
				<div className={styles.siblingSidePostFocal}>
					{siblingsAfterFocal.map((s) => (
						<SiblingCard key={s.entityId} related={s} />
					))}
				</div>

				{spouses.length > 0 ? (
					<>
						<div className={styles.spouseBridgeCenter}>
							<div className={styles.spouseConnectorBridge}>
								<div className={styles.spouseConnectorLine} aria-hidden />
								<span className={styles.spouseConnectorLabel}>
									{spouseSectionLabel}
								</span>
								<div className={styles.spouseConnectorTail} aria-hidden />
							</div>
						</div>
						<div className={styles.spouseTierFullWidth}>
							<div className={styles.spouseTierCards}>
								<SpouseUnitNodes units={spouseUnits} keyPrefix="sp" />
							</div>
						</div>
					</>
				) : null}
			</div>

			{sortedChildren.length > 0 ? (
				<>
					<div className={styles.connector} aria-hidden />
					<p className={styles.tierLabel}>ילדים</p>
					{childKeys.length <= 1 && childKeys[0] === null ? (
						<div className={styles.row}>
							{sortedChildren.map((edge) => (
								<ChildCard
									key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}-${edge.altGroupId ?? "d"}`}
									edge={edge}
								/>
							))}
						</div>
					) : (
						childKeys.map((key) => {
							const group = childGroups.get(key) ?? [];
							const sorted = [...group].sort((a, b) =>
								a.related.displayName.localeCompare(b.related.displayName, "he"),
							);
							return (
								<div key={key ?? "default"} className={styles.altGroupBlock}>
									{key !== null ? (
										<div className={styles.altGroupLabel}>חלופי</div>
									) : null}
									<div className={styles.row}>
										{sorted.map((edge) => (
											<ChildCard
												key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}-${key ?? "d"}`}
												edge={edge}
											/>
										))}
									</div>
								</div>
							);
						})
					)}
				</>
			) : null}
		</section>
	);
}
