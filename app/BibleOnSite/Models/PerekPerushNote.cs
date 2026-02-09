namespace BibleOnSite.Models;

/// <summary>
/// A single commentary note for a pasuk.
/// Matches legacy PerekPerush: perush_id, perek_id, pasuk, note_idx, note_content.
/// </summary>
public class PerekPerushNote
{
    /// <summary>References perush.id from catalog.</summary>
    public int PerushId { get; set; }

    /// <summary>Hebrew name of the perush (for display).</summary>
    public required string PerushName { get; set; }

    public int PerekId { get; set; }
    public int Pasuk { get; set; }
    public int NoteIdx { get; set; }

    /// <summary>The commentary text (may contain HTML).</summary>
    public required string NoteContent { get; set; }
}
