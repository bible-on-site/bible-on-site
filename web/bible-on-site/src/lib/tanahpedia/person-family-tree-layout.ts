import {
	compareChildEdgesChronology,
	shouldApplyChildBirthChronology,
} from "./person-family-chronology";
import {
	formatUnionYyyymmdd,
	personSexCornerMark,
	unionEndReasonLabel,
} from "./person-family-labels";
import type {
	PersonFamilyChildEdge,
	PersonFamilyParentEdge,
	PersonFamilySpouseEdge,
} from "./types";

export type CoParentChildBucket = {
	key: string;
	coParentEntityId: string | null;
	coParentDisplayName: string | null;
	coParentUnionOrder: number | null;
	edges: PersonFamilyChildEdge[];
};

export function partitionChildrenByCoParent(
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

export function shouldShowCoParentSubtitles(
	buckets: CoParentChildBucket[],
	spouseUnits: SpouseUnit[],
): boolean {
	if (buckets.length > 1) return true;
	if (buckets.length === 0 || buckets[0].coParentEntityId == null) return false;
	return (
		spouseUnits.length !== 1 ||
		buckets[0].coParentEntityId !== spouseUnits[0].edges[0].related.entityId
	);
}

/** מטריצת בן-זוג+ילדים — לא כשחלופי מחייב כמה ישויות שונות באותו בלוק */
export function canUseSpouseChildMatrix(units: SpouseUnit[]): boolean {
	return !units.some((u) => {
		const n = new Set(u.edges.map((e) => e.related.entityId)).size;
		return u.altGroupKey != null && n > 1;
	});
}

export function buildPartnerChildColumns(
	childEdges: PersonFamilyChildEdge[],
	spouseUnits: SpouseUnit[],
): {
	columnChildren: Map<string, PersonFamilyChildEdge[]>;
	looseChildren: PersonFamilyChildEdge[];
} {
	const chronology = shouldApplyChildBirthChronology(childEdges);
	const cmp = (a: PersonFamilyChildEdge, b: PersonFamilyChildEdge) =>
		chronology
			? compareChildEdgesChronology(a, b)
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

export function childEdgeCoParentOutsideSpouses(
	edge: PersonFamilyChildEdge,
	spousePartnerIds: Set<string>,
): boolean {
	return (
		edge.coParentEntityId == null ||
		!spousePartnerIds.has(edge.coParentEntityId)
	);
}

export function groupByAltGroupId<T extends { altGroupId: string | null }>(
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

export type SpouseUnit = {
	altGroupKey: string | null;
	edges: PersonFamilySpouseEdge[];
};

/** Build display units: null alt_group → one edge each; non-null → cluster by partner entity. */
export function buildSpouseUnits(spouses: PersonFamilySpouseEdge[]): SpouseUnit[] {
	const units: SpouseUnit[] = [];
	const withoutAlt = spouses.filter((s) => s.altGroupId == null);
	const withAlt = spouses.filter((s) => s.altGroupId != null);

	for (const e of withoutAlt) {
		units.push({ altGroupKey: null, edges: [e] });
	}

	const byAlt = groupByAltGroupId(withAlt);
	// withAlt contains only non-null keys; iterate entries so every group is present.
	const altGroups = [...byAlt.entries()].sort(([a], [b]) =>
		String(a).localeCompare(String(b)),
	);

	for (const [key, group] of altGroups) {
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
export function fuseMarriageAndForbiddenSpouseRows(units: SpouseUnit[]): SpouseUnit[] {
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

export function sortEdgesForOpinions(
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

export function citationLines(text: string | null) {
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

export function sexMarkDataAttribute(sex: string | null): "" | undefined {
	return personSexCornerMark(sex) ? "" : undefined;
}

export function spouseTimelineSuffix(edge: PersonFamilySpouseEdge): string {
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
export function spouseTimelinePlain(edge: PersonFamilySpouseEdge): string {
	const t = spouseTimelineSuffix(edge);
	return t.startsWith(" · ") ? t.slice(3).trim() : t.trim();
}

/** Show relationship evidence once on the child, preferring a verse shared by both parents. */
export function parentSourceCitation(
	parents: PersonFamilyParentEdge[],
): string | null {
	const sourceRoles = new Map<string, Set<string>>();
	for (const parent of parents) {
		for (const { line } of citationLines(parent.sourceCitation)) {
			const roles = sourceRoles.get(line) ?? new Set<string>();
			roles.add(parent.parentRole);
			sourceRoles.set(line, roles);
		}
	}
	const oneParentPerRole =
		parents.filter((p) => p.parentRole === "FATHER").length === 1 &&
		parents.filter((p) => p.parentRole === "MOTHER").length === 1;
	const shared = oneParentPerRole
		? [...sourceRoles].find(
				([, roles]) => roles.has("FATHER") && roles.has("MOTHER"),
			)
		: undefined;
	return shared?.[0] ?? ([...sourceRoles.keys()].join("\n") || null);
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
