import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	ENTITY_TYPE_LABELS,
	getEntryByUniqueName,
} from "@/lib/tanahpedia/service";
import type { EntityType } from "@/lib/tanahpedia/types";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ uniqueName: string }>;
}): Promise<Metadata> {
	const { uniqueName } = await params;
	const entry = await getEntryByUniqueName(decodeURIComponent(uniqueName));
	if (!entry) return { title: "לא נמצא" };
	return {
		title: `${entry.title} | תנ"ךפדיה`,
		description: entry.content?.slice(0, 200) ?? entry.title,
	};
}

export default async function EntryPage({
	params,
}: {
	params: Promise<{ uniqueName: string }>;
}) {
	const { uniqueName } = await params;
	const entry = await getEntryByUniqueName(decodeURIComponent(uniqueName));
	if (!entry) notFound();

	return (
		<main
			dir="rtl"
			style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}
		>
			<nav style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#666" }}>
				<Link
					href="/tanahpedia"
					style={{ color: "#0066cc", textDecoration: "none" }}
				>
					תנ&quot;ךפדיה
				</Link>
				{" > "}
				<span>{entry.title}</span>
			</nav>

			<h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>{entry.title}</h1>

			{entry.entities.length > 0 && (
				<div
					style={{
						display: "flex",
						gap: "0.5rem",
						marginBottom: "1.5rem",
						flexWrap: "wrap",
					}}
				>
					{entry.entities.map((ee) => (
						<Link
							key={ee.id}
							href={`/tanahpedia/${ee.entityType.toLowerCase()}`}
							style={{
								display: "inline-block",
								padding: "0.25rem 0.75rem",
								background: "#e8f0fe",
								borderRadius: "12px",
								fontSize: "0.85rem",
								textDecoration: "none",
								color: "#1a73e8",
							}}
						>
							{ENTITY_TYPE_LABELS[ee.entityType as EntityType] ?? ee.entityType}
						</Link>
					))}
				</div>
			)}

			{entry.content ? (
				<article
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored content
					dangerouslySetInnerHTML={{ __html: entry.content }}
					style={{ lineHeight: "1.8", fontSize: "1.1rem" }}
				/>
			) : (
				<p style={{ color: "#888" }}>אין תוכן עדיין לערך זה.</p>
			)}
		</main>
	);
}
