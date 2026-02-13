using CommunityToolkit.Mvvm.ComponentModel;

namespace BibleOnSite.Models;

/// <summary>
/// Perush name + its note contents for display under a pasuk.
/// Used to render commentary inline with the text.
/// </summary>
public partial class PerushNoteDisplay : ObservableObject
{
    /// <summary>Hebrew name of the commentary (e.g. רש"י).</summary>
    public required string PerushName { get; set; }

    /// <summary>List of note contents for this perush on this pasuk.</summary>
    public List<string> NoteContents { get; set; } = new();

    /// <summary>Combined HTML content for display (notes joined).</summary>
    public string DisplayContent => NoteContents.Count == 0
        ? string.Empty
        : string.Join(" ", NoteContents);
}
