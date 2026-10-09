import type { EntryLinkOption } from "~/components/editor/EntryLinkPicker";
import { listTanahpediaEntriesForAdmin } from "~/server/tanahpedia/entries";

/** Module-level so the picker's effect keeps a stable dependency. */
export async function searchEntriesForLink(
	query: string,
): Promise<EntryLinkOption[]> {
	const rows = await listTanahpediaEntriesForAdmin({
		data: { q: query.trim() || undefined },
	});
	return rows.map((row) => ({
		id: row.id,
		title: row.title,
		uniqueName: row.unique_name,
	}));
}
