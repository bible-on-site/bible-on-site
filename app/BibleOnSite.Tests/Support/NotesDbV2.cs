using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Support;

/// <summary>
/// Builds v2 perushim-notes fixture databases matching the shipped schema:
/// `_metadata` (with schema_version), `note_blob` (PNB1 zlib blobs per perek),
/// and `perek_perush`.
/// </summary>
internal static class NotesDbV2
{
    /// <summary>DDL + INSERT statements for a v2 notes DB containing the given notes.</summary>
    public static string[] Statements(params (int PerushId, int PerekId, int Pasuk, int NoteIdx, string? Content)[] rows)
    {
        var statements = new List<string>
        {
            "CREATE TABLE IF NOT EXISTS _metadata (key TEXT PRIMARY KEY, value TEXT)",
            $"INSERT OR REPLACE INTO _metadata VALUES ('schema_version','{PerushNoteBlob.SchemaVersion}')",
            "CREATE TABLE IF NOT EXISTS note_blob (perek_id INTEGER PRIMARY KEY, data BLOB NOT NULL)",
            "CREATE TABLE IF NOT EXISTS perek_perush (perek_id INTEGER NOT NULL, perush_id INTEGER NOT NULL, " +
                "PRIMARY KEY (perek_id, perush_id))",
        };
        foreach (var perek in rows.GroupBy(row => row.PerekId))
        {
            var notes = perek
                .OrderBy(row => row.Pasuk).ThenBy(row => row.PerushId).ThenBy(row => row.NoteIdx)
                .Select(row => new PerushNoteBlob.Note(row.PerushId, row.Pasuk, row.NoteIdx, row.Content ?? string.Empty))
                .ToList();
            statements.Add($"INSERT OR REPLACE INTO note_blob VALUES ({perek.Key}, X'{Convert.ToHexString(PerushNoteBlob.Encode(notes))}')");
            foreach (var perushId in perek.Select(row => row.PerushId).Distinct())
            {
                statements.Add($"INSERT OR IGNORE INTO perek_perush VALUES ({perek.Key}, {perushId})");
            }
        }
        return [.. statements];
    }
}
