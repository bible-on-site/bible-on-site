import Link from "next/link";
import type { EntityWithEntries } from "@/lib/tanahpedia/types";

export function EntityListItem({ entity }: { entity: EntityWithEntries }) {
	const { entityName, linkedEntries } = entity;

	if (linkedEntries.length === 0) {
		return (
			<li style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
				<span style={{ color: "#999" }}>{entityName}</span>
			</li>
		);
	}

	if (linkedEntries.length === 1) {
		const entry = linkedEntries[0];
		return (
			<li style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
				<Link
					href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
					style={{ textDecoration: "none", color: "#0066cc" }}
				>
					{entityName}
				</Link>
			</li>
		);
	}

	return (
		<li style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee" }}>
			<span>{entityName}</span>
			{" ["}
			{linkedEntries.map((entry, i) => (
				<span key={entry.id}>
					{i > 0 && ", "}
					<Link
						href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
						style={{ textDecoration: "none", color: "#0066cc" }}
					>
						{entry.title}
					</Link>
				</span>
			))}
			{"]"}
		</li>
	);
}
