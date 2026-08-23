import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	ENTITY_TYPE_LABELS,
	type EntityType,
} from "~/lib/tanahpedia/labels";
import { linkExistingEntityToEntry, searchEntities } from "~/server/tanahpedia/structural";

interface ExistingEntityPickerProps {
	entryId: string;
	entityType?: EntityType;
	onLinked: () => void;
}

export function ExistingEntityPicker({
	entryId,
	entityType,
	onLinked,
}: ExistingEntityPickerProps) {
	const [term, setTerm] = useState("");
	const [linkingId, setLinkingId] = useState<string | null>(null);

	const { data, isLoading, error } = useQuery({
		queryKey: ["tanahpedia-entity-search", entryId, term, entityType],
		queryFn: () =>
			searchEntities({ data: { entryId, query: term, entityType } }),
	});

	async function link(entityId: string) {
		setLinkingId(entityId);
		try {
			await linkExistingEntityToEntry({ data: { entryId, entityId } });
			onLinked();
		} finally {
			setLinkingId(null);
		}
	}

	return (
		<div className="mt-4 border-t border-gray-200 pt-4">
			<label
				htmlFor="existing-entity-search"
				className="block text-xs font-medium text-gray-600 mb-1"
			>
				או קשר יישות קיימת
			</label>
			<input
				id="existing-entity-search"
				type="search"
				value={term}
				onChange={(e) => setTerm(e.target.value)}
				placeholder="חפש יישות קיימת לפי שם…"
				className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm"
			/>

			{error && (
				<p className="text-xs text-red-700 mt-2">חיפוש היישויות נכשל.</p>
			)}
			{!error && isLoading && <p className="text-xs text-gray-500 mt-2">טוען…</p>}
			{!error && !isLoading && (data?.length ?? 0) === 0 && (
				<p className="text-xs text-gray-500 mt-2">לא נמצאו יישויות מתאימות.</p>
			)}

			{(data?.length ?? 0) > 0 && (
				<ul className="mt-2 max-h-48 overflow-auto divide-y divide-gray-100 border border-gray-200 rounded-md bg-white">
					{data?.map((entity) => (
						<li
							key={entity.entityId}
							className="flex items-center justify-between gap-2 px-2 py-1.5"
						>
							<span className="text-sm">
								{entity.name}
								<span className="text-xs text-gray-500 mr-2">
									{ENTITY_TYPE_LABELS[entity.entityType]}
								</span>
							</span>
							<button
								type="button"
								onClick={() => link(entity.entityId)}
								disabled={linkingId === entity.entityId}
								className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50"
							>
								{linkingId === entity.entityId ? "מקשר…" : "קשר"}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
