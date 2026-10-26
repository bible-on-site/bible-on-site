import type mysql from "mysql2/promise";
import { reservedCategoryLabelFor } from "~/lib/tanahpedia/pedia-names";
import { txExecute, txQuery } from "../db";

/**
 * Server-only transactional alias ops shared by the entry save path.
 * Lives in a `.server` module (never imported by client code) — plain
 * functions exported from a `createServerFn` module stay live in the client
 * bundle and would drag `../db`/`mysql2` into it.
 */

/**
 * Keeps a renamed entry's previous unique_name as a single-target alias to it,
 * so inbound links keep working — applied inside the entry save transaction.
 * Deliberately refuses an occupied name (shared alias rows exist): adding the
 * entry silently would steal or change a URL owned by other entries. Returns
 * whether the alias row was created.
 */
export async function keepOldNameAsAliasInTx(
	conn: mysql.PoolConnection,
	entryId: string,
	oldName: string,
): Promise<boolean> {
	if (reservedCategoryLabelFor(oldName)) return false;
	const rows = await txQuery<{ id: string }>(
		conn,
		"SELECT id FROM tanahpedia_entry_synonym WHERE name = ? FOR UPDATE",
		[oldName],
	);
	if (rows.length > 0) return false;
	await txExecute(
		conn,
		"INSERT INTO tanahpedia_entry_synonym (id, name, entry_id) VALUES (?, ?, ?)",
		[crypto.randomUUID(), oldName, entryId],
	);
	return true;
}

/**
 * Drops this entry's own now-shadowed alias association when `newName` became
 * its canonical unique_name — a name equal to the main address is dead weight.
 * Other entries' associations stay (they remain readable/editable as shadowed
 * names in their own editors).
 */
export async function dropSelfShadowedAliasInTx(
	conn: mysql.PoolConnection,
	entryId: string,
	newName: string,
): Promise<void> {
	await txExecute(
		conn,
		"DELETE FROM tanahpedia_entry_synonym WHERE name = ? AND entry_id = ?",
		[newName, entryId],
	);
	// Stray label rows for this entry under other rows of the same name.
	await txExecute(
		conn,
		`DELETE d FROM tanahpedia_entry_synonym_disambiguation d
		 JOIN tanahpedia_entry_synonym s ON s.id = d.synonym_id
		 WHERE s.name = ? AND d.entry_id = ?`,
		[newName, entryId],
	);
}
