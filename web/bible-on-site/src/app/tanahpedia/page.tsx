import type { Metadata } from "next";
import Link from "next/link";
import {
	ENTITY_TYPE_LABELS,
	ENTITY_TYPES,
	getEntityTypeCounts,
	getRecentEntries,
} from "@/lib/tanahpedia/service";
import type { EntityType } from "@/lib/tanahpedia/types";

export const metadata: Metadata = {
	title: 'תנ"ךפדיה',
	description: 'אנציקלופדיה לתנ"ך - אישים, מקומות, אירועים ועוד',
};

export default async function TanahpediaLandingPage() {
	const [counts, recentEntries] = await Promise.all([
		getEntityTypeCounts(),
		getRecentEntries(8),
	]);

	return (
		<main
			dir="rtl"
			style={{ padding: "2rem", maxWidth: "1200px", margin: "0 auto" }}
		>
			<h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>תנ&quot;ךפדיה</h1>
			<p style={{ marginBottom: "2rem", color: "#555" }}>
				אנציקלופדיה לתנ&quot;ך - אישים, מקומות, אירועים, חפצים ועוד
			</p>

			<section style={{ marginBottom: "3rem" }}>
				<h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>קטגוריות</h2>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
						gap: "1rem",
					}}
				>
					{ENTITY_TYPES.map((et: EntityType) => (
						<Link
							key={et}
							href={`/tanahpedia/${et.toLowerCase()}`}
							style={{
								display: "block",
								padding: "1.5rem",
								border: "1px solid #ddd",
								borderRadius: "8px",
								textAlign: "center",
								textDecoration: "none",
								color: "inherit",
							}}
						>
							<div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
								{ENTITY_TYPE_LABELS[et]}
							</div>
							<div
								style={{
									fontSize: "0.9rem",
									color: "#888",
									marginTop: "0.5rem",
								}}
							>
								{counts[et]} ערכים
							</div>
						</Link>
					))}
				</div>
			</section>

			{recentEntries.length > 0 && (
				<section>
					<h2 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
						ערכים אחרונים
					</h2>
					<ul style={{ listStyle: "none", padding: 0 }}>
						{recentEntries.map((entry) => (
							<li key={entry.id} style={{ marginBottom: "0.5rem" }}>
								<Link
									href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
									style={{ textDecoration: "none", color: "#0066cc" }}
								>
									{entry.title}
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}
