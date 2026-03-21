import Link from "next/link";
import type {
	PersonFamilyChildEdge,
	PersonFamilyParentEdge,
	PersonFamilyRelatedPerson,
	PersonFamilySpouseEdge,
	PersonFamilySummary,
} from "@/lib/tanahpedia/types";
import {
	parentRoleLabel,
	parentRoleSortKey,
	relationshipTypeLabel,
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

function ParentCard({ edge }: { edge: PersonFamilyParentEdge }) {
	const role = parentRoleLabel(edge.parentRole);
	const rel = relationshipTypeLabel(edge.relationshipType);
	const extra =
		edge.relationshipType !== "BIOLOGICAL" ? ` · ${rel}` : "";
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
	const extra =
		edge.relationshipType !== "BIOLOGICAL" ? ` · ${rel}` : "";
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
	const order =
		edge.unionOrder != null ? ` · סדר ${edge.unionOrder}` : "";
	return (
		<div className={styles.card}>
			<PersonNameLink related={edge.related} />
			<span className={styles.meta}>
				{u}
				{order}
			</span>
			{citationLine(edge.sourceCitation)}
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

export function PersonFamilyTree({ summary }: { summary: PersonFamilySummary }) {
	const {
		focalDisplayName,
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

	const sortedChildren = [...children].sort((a, b) =>
		a.related.displayName.localeCompare(b.related.displayName, "he"),
	);

	const spouseGroups = groupByAltGroupId(spouses);
	const spouseKeys = [...spouseGroups.keys()].sort((a, b) => {
		if (a === b) return 0;
		if (a === null) return -1;
		if (b === null) return 1;
		return a.localeCompare(b);
	});

	const sortedSpousesGlobal = [...spouses].sort((a, b) => {
		const ao = a.unionOrder ?? 999;
		const bo = b.unionOrder ?? 999;
		if (ao !== bo) return ao - bo;
		return a.related.displayName.localeCompare(b.related.displayName, "he");
	});

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
								<ParentCard key={`${edge.related.entityId}-${edge.parentRole}-${edge.relationshipType}`} edge={edge} />
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

			<div className={styles.row}>
				<div className={styles.cardFocal}>
					<span className={styles.personUnlinked}>{focalDisplayName}</span>
				</div>
			</div>

			{sortedSpousesGlobal.length > 0 ? (
				<>
					<p className={styles.tierLabel}>בני זוג</p>
					{spouseKeys.length <= 1 && spouseKeys[0] === null ? (
						<div className={styles.row}>
							{sortedSpousesGlobal.map((edge) => (
								<SpouseCard
									key={`${edge.related.entityId}-${edge.unionType}-${edge.unionOrder ?? "x"}`}
									edge={edge}
								/>
							))}
						</div>
					) : (
						spouseKeys.map((key) => {
							const group = spouseGroups.get(key) ?? [];
							const sorted = [...group].sort((a, b) => {
								const ao = a.unionOrder ?? 999;
								const bo = b.unionOrder ?? 999;
								if (ao !== bo) return ao - bo;
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
											<SpouseCard
												key={`${edge.related.entityId}-${edge.unionType}-${edge.unionOrder ?? "x"}-${key ?? "d"}`}
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

			{sortedChildren.length > 0 ? (
				<>
					<p className={styles.tierLabel}>ילדים</p>
					<div className={styles.row}>
						{sortedChildren.map((edge) => (
							<ChildCard
								key={`${edge.related.entityId}-${edge.parentRole}`}
								edge={edge}
							/>
						))}
					</div>
				</>
			) : null}

			{siblings.length > 0 ? (
				<>
					<p className={styles.tierLabel}>אחים</p>
					<div className={styles.row}>
						{siblings.map((s) => (
							<SiblingCard key={s.entityId} related={s} />
						))}
					</div>
				</>
			) : null}
		</section>
	);
}
