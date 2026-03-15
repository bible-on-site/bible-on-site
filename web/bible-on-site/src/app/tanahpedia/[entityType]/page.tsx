import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	ENTITY_TYPE_LABELS,
	ENTITY_TYPES,
	getCategoryHomepage,
	getEntitiesWithEntries,
} from "@/lib/tanahpedia/service";
import type { EntityType } from "@/lib/tanahpedia/types";
import { EntityListItem } from "../components/EntityListItem";

function normalizeEntityType(param: string): EntityType | null {
	const upper = param.toUpperCase();
	if (ENTITY_TYPES.includes(upper as EntityType)) return upper as EntityType;
	return null;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ entityType: string }>;
}): Promise<Metadata> {
	const { entityType: param } = await params;
	const entityType = normalizeEntityType(param);
	if (!entityType) return { title: "לא נמצא" };
	return {
		title: `${ENTITY_TYPE_LABELS[entityType]} | תנ"ךפדיה`,
		description: `רשימת ${ENTITY_TYPE_LABELS[entityType]} בתנ"ך`,
	};
}

export default async function EntityTypePage({
	params,
}: {
	params: Promise<{ entityType: string }>;
}) {
	const { entityType: param } = await params;
	const entityType = normalizeEntityType(param);
	if (!entityType) notFound();

	const [entities, homepage] = await Promise.all([
		getEntitiesWithEntries(entityType),
		getCategoryHomepage(entityType),
	]);

	const label = ENTITY_TYPE_LABELS[entityType];

	return (
		<main
			dir="rtl"
			style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}
		>
			<nav style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#666" }}>
				<Link
					href="/tanahpedia"
					style={{ color: "#0066cc", textDecoration: "none" }}
				>
					תנ&quot;ךפדיה
				</Link>
				{" > "}
				<span>{label}</span>
			</nav>

			<h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>{label}</h1>

			{homepage?.content && (
				<div
					style={{ marginBottom: "2rem" }}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored content
					dangerouslySetInnerHTML={{ __html: homepage.content }}
				/>
			)}

			{homepage?.layoutType === "MAP" && entityType === "PLACE" && (
				<PlaceMapFallback />
			)}

			<section>
				<h2 style={{ fontSize: "1.3rem", marginBottom: "1rem" }}>
					{entities.length} {label}
				</h2>
				<ul style={{ listStyle: "none", padding: 0 }}>
					{entities.map((entity) => (
						<EntityListItem key={entity.entityId} entity={entity} />
					))}
				</ul>
			</section>
		</main>
	);
}

function PlaceMapFallback() {
	return (
		<div
			style={{
				background: "#f0f0f0",
				padding: "3rem",
				textAlign: "center",
				borderRadius: "8px",
				marginBottom: "2rem",
				color: "#888",
			}}
		>
			מפת מקומות (OpenGIS) - תתווסף בקרוב
		</div>
	);
}
