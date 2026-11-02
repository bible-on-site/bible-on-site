using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using CommunityToolkit.Mvvm.ComponentModel;
using System.Text;

namespace BibleOnSite.Models;

/// <summary>
/// Represents a single Pasuk (verse) within a Perek.
/// </summary>
public partial class Pasuk : ObservableObject
{
    /// <summary>
    /// The verse number within the perek (1-based).
    /// </summary>
    public int PasukNum { get; set; }

    /// <summary>
    /// Whether this pasuk is currently selected.
    /// </summary>
    [ObservableProperty]
    private bool _isSelected;

    // Selection changes the recitation word's styling, so the cached
    // FormattedString must rebuild on every toggle.
    partial void OnIsSelectedChanged(bool value)
    {
        _ = value;
        InvalidateFormatted();
        OnPropertyChanged(nameof(FormattedText));
    }

    private int? _recitingSegment;

    public int? RecitingSegment
    {
        get => _recitingSegment;
        set
        {
            if (_recitingSegment == value)
            {
                return;
            }
            OnPropertyChanging(nameof(RecitingSegment));
            _recitingSegment = value;
            InvalidateFormatted();
            OnPropertyChanged(nameof(FormattedText));
            OnPropertyChanged(nameof(RecitingSegment));
        }
    }

    /// <summary>
    /// The verse number in Hebrew letters (e.g., א, ב, ג).
    /// </summary>
    public string PasukNumHeb => PasukNum.ToHebrewLetters();

    /// <summary>
    /// The text content of the pasuk (plain text concatenation of segments).
    /// </summary>
    public required string Text { get; set; }

    /// <summary>
    /// The segments that make up this pasuk (for rich rendering).
    /// </summary>
    private List<PasukSegment> _segments = new();

    /// <summary>Most-recently-used entries of <see cref="FormattedText"/> per
    /// pasuk. A strong <see cref="FormattedString"/> retains its subscribers
    /// (MAUI 10.0.90 Labels subscribe to it), so an unbounded cache would pin
    /// recycled Labels in buffered perakim; a bare WeakReference instead loses
    /// ~40% of rebinds to GC churn while scrolling (#2309). Bounding the MRU
    /// keeps retention capped at the freshest pesukim and absorbs that churn.
    /// </summary>
    private const int FormattedCacheCapacity = 128;
    private static readonly object _formattedCacheLock = new();
    private static readonly LinkedList<Pasuk> _formattedMru = new();
    private static readonly Dictionary<Pasuk, (LinkedListNode<Pasuk> Node, FormattedString Formatted)> _formattedCache = new();
    // The masking revision the cached FormattedString was built under — a
    // הסתר שם השם settings change bumps DivineNameMasking.Revision, which
    // invalidates the cache without touching the canonical segments.
    private int _formattedRevision = -1;

    public List<PasukSegment> Segments
    {
        get => _segments;
        set
        {
            _segments = value;
            InvalidateFormatted();
            OnPropertyChanged(nameof(FormattedText));
        }
    }

    /// <summary>
    /// Perushim (commentaries) for this pasuk. Populated when perushim are loaded and filtered.
    /// </summary>
    [ObservableProperty]
    private List<PerushNoteDisplay> _perushNotes = new();

    /// <summary>BindableLayout receives incremental changes, preserving already rendered cells.</summary>
    public ObservableCollection<PerushNoteDisplay> VisiblePerushNotes { get; } = new();

    partial void OnPerushNotesChanged(List<PerushNoteDisplay> value)
    {
        for (var i = VisiblePerushNotes.Count - 1; i >= 0; i--)
        {
            if (!value.Contains(VisiblePerushNotes[i])) { VisiblePerushNotes.RemoveAt(i); }
        }
        for (var i = 0; i < value.Count; i++)
        {
            var previous = VisiblePerushNotes.IndexOf(value[i]);
            if (previous < 0) { VisiblePerushNotes.Insert(i, value[i]); }
            else if (previous != i) { VisiblePerushNotes.Move(previous, i); }
        }
    }

    /// <summary>
    /// Gets the formatted text representation with qri/ktiv handling.
    /// Qri segments that differ from ktiv are displayed as "(קְרִי: value)" in a distinct color.
    /// </summary>
    public FormattedString FormattedText
    {
        get
        {
            lock (_formattedCacheLock)
            {
                if (_formattedCache.TryGetValue(this, out var entry) &&
                    _formattedRevision == DivineNameMasking.Revision &&
                    _formattedDark == IsDarkTheme)
                {
                    _formattedMru.Remove(entry.Node);
                    _formattedMru.AddFirst(entry.Node);
                    return entry.Formatted;
                }
            }

            var formatted = BuildFormattedText();
            _formattedRevision = DivineNameMasking.Revision;
            _formattedDark = IsDarkTheme;
            lock (_formattedCacheLock)
            {
                if (_formattedCache.Remove(this, out var stale))
                {
                    _formattedMru.Remove(stale.Node);
                }
                _formattedCache[this] = (_formattedMru.AddFirst(this), formatted);
                while (_formattedMru.Count > FormattedCacheCapacity)
                {
                    _formattedCache.Remove(_formattedMru.Last!.Value);
                    _formattedMru.RemoveLast();
                }
            }
            return formatted;
        }
    }

    private void InvalidateFormatted()
    {
        lock (_formattedCacheLock)
        {
            if (_formattedCache.Remove(this, out var entry))
            {
                _formattedMru.Remove(entry.Node);
            }
        }
        _formattedRevision = -1;
    }

    private static readonly Color QriColor = Color.FromArgb("#637598");
    private static readonly Color QriColorDark = Color.FromArgb("#8FA3C8");
    private static readonly Color RecitingTextColor = Color.FromArgb("#1c427b");
    private static readonly Color RecitingTextColorDark = Color.FromArgb("#AACBFF");
    private static readonly Color RecitingBackgroundColor = Color.FromArgb("#e9eff8");
    private static readonly Color RecitingBackgroundColorDark = Color.FromArgb("#2C4569");
    // On a selected row the plain recitation tint drowns in the selection
    // background, so the recited word gets a stronger tint and weight (#2473).
    private static readonly Color RecitingSelectedBackgroundColor = Color.FromArgb("#a8cbf4");
    private static readonly Color RecitingSelectedBackgroundColorDark = Color.FromArgb("#3D5A80");
    private static readonly Color MasoraMarkColor = Color.FromArgb("#9a92d1");
    private static readonly Color MasoraMarkColorDark = Color.FromArgb("#C3BBF2");

    /// <summary>Resolved once per <see cref="FormattedText"/> build; the cache
    /// is invalidated when the requested theme no longer matches.</summary>
    private bool _formattedDark;

    private static bool IsDarkTheme =>
        Application.Current?.RequestedTheme == AppTheme.Dark;

    /// <summary>Themed qri/tappable-word ink — the focused-pasuk overlay in the
    /// reader pages paints these from the same palette.</summary>
    internal static Color QriTextColor => IsDarkTheme ? QriColorDark : QriColor;
    /// <summary>Themed recited-word ink.</summary>
    internal static Color RecitingText => IsDarkTheme ? RecitingTextColorDark : RecitingTextColor;
    /// <summary>Themed recited-word highlight.</summary>
    internal static Color RecitingBackgroundDefault => IsDarkTheme ? RecitingBackgroundColorDark : RecitingBackgroundColor;
    private static Color MasoraMark => IsDarkTheme ? MasoraMarkColorDark : MasoraMarkColor;

    /// <summary>
    /// Called by the reader pages when the requested app theme changes so
    /// already-materialized spans rebuild with the other theme's colors on the
    /// next binding pull instead of keeping stale baked-in colors.
    /// </summary>
    internal void RefreshForThemeChange()
    {
        lock (_formattedCacheLock)
        {
            if (!_formattedCache.ContainsKey(this) || _formattedDark == IsDarkTheme)
            {
                return;
            }
        }
        InvalidateFormatted();
        OnPropertyChanged(nameof(FormattedText));
    }

    private FormattedString BuildFormattedText()
    {
        var formatted = new FormattedString();
        var plain = new StringBuilder();

        void FlushPlain()
        {
            if (plain.Length == 0)
            {
                return;
            }
            formatted.Spans.Add(new Span { Text = plain.ToString() });
            plain.Clear();
        }

        for (int i = 0; i < Segments.Count; i++)
        {
            var segment = Segments[i];
            bool isLast = i == Segments.Count - 1;

            switch (segment.Type)
            {
                case SegmentType.Ktiv:
                    // Ktiv: always show the written text (masked for display
                    // only — segment.Value stays canonical)
                    if (!string.IsNullOrEmpty(segment.Value))
                    {
                        plain.Append(DivineNameMasking.MaskText(segment.Value));
                    }
                    break;

                case SegmentType.Qri:
                    if (segment.IsQriDifferentThanKtiv)
                    {
                        // Qri differs from ktiv: show "(קְרִי: value)" with special styling.
                        // MaskText (not MaskValue) — a bracketed qri can hold several words.
                        FlushPlain();
                        formatted.Spans.Add(new Span
                        {
                            Text = "(קְרִי: ",
                            TextColor = QriTextColor,
                            FontSize = 14
                        });
                        var variantReciting = RecitingSegment == i + 1;
                        formatted.Spans.Add(new Span
                        {
                            Text = DivineNameMasking.MaskText(segment.Value),
                            TextColor = variantReciting ? RecitingText : QriTextColor,
                            BackgroundColor = variantReciting ? RecitingBackground() : null,
                            FontAttributes = variantReciting && IsSelected ? FontAttributes.Bold : FontAttributes.None
                        });
                        formatted.Spans.Add(new Span
                        {
                            Text = ")",
                            TextColor = QriTextColor,
                            FontSize = 14
                        });
                    }
                    else
                    {
                        // Regular qri (same as ktiv): show normally
                        if (!string.IsNullOrEmpty(segment.Value))
                        {
                            if (RecitingSegment == i + 1)
                            {
                                FlushPlain();
                                formatted.Spans.Add(new Span
                                {
                                    Text = DivineNameMasking.MaskText(segment.Value),
                                    TextColor = RecitingText,
                                    BackgroundColor = RecitingBackground(),
                                    FontAttributes = IsSelected ? FontAttributes.Bold : FontAttributes.None
                                });
                            }
                            else
                            {
                                plain.Append(DivineNameMasking.MaskText(segment.Value));
                            }
                        }
                    }
                    break;

                case SegmentType.Ptuha:
                    FlushPlain();
                    formatted.Spans.Add(new Span
                    {
                        Text = " {פ} ",
                        TextColor = MasoraMark,
                        FontAttributes = FontAttributes.Bold
                    });
                    break;

                case SegmentType.Stuma:
                    FlushPlain();
                    formatted.Spans.Add(new Span
                    {
                        Text = " {ס} ",
                        TextColor = MasoraMark,
                        FontAttributes = FontAttributes.Bold
                    });
                    break;

                default:
                    throw new ArgumentOutOfRangeException(nameof(segment.Type), segment.Type,
                        "Unknown verse segment type");
            }

            // Add space after segment unless:
            // - It's the last segment
            // - The segment ends with maqaf (Hebrew hyphen)
            // - It's a parsha marker (already has spaces)
            if (!isLast &&
                segment.Type != SegmentType.Ptuha &&
                segment.Type != SegmentType.Stuma &&
                !segment.EndsWithMaqaf &&
                !string.IsNullOrEmpty(segment.Value))
            {
                plain.Append(' ');
            }
        }

        FlushPlain();
        return formatted;
    }

    private Color RecitingBackground() => IsSelected
        ? (IsDarkTheme ? RecitingSelectedBackgroundColorDark : RecitingSelectedBackgroundColor)
        : (IsDarkTheme ? RecitingBackgroundColorDark : RecitingBackgroundColor);
}

/// <summary>
/// Represents a segment within a pasuk (text, qri, ktiv, or parsha marker).
/// </summary>
public class PasukSegment
{
    /// <summary>
    /// The type of segment.
    /// </summary>
    public SegmentType Type { get; set; }

    /// <summary>
    /// The text value of this segment (empty for ptuha/stuma).
    /// </summary>
    public string Value { get; set; } = string.Empty;

    /// <summary>
    /// For qri segments: offset to paired ktiv segment.
    /// For ktiv segments: offset to paired qri segment.
    /// Null for regular text or parsha markers.
    /// </summary>
    public int? PairedOffset { get; set; }

    /// <summary>
    /// Whether this qri differs from its ktiv (qri has a different reading).
    /// </summary>
    public bool IsQriDifferentThanKtiv => Type == SegmentType.Qri && PairedOffset.HasValue;

    /// <summary>
    /// Whether this ktiv differs from its qri (ktiv has a different spelling).
    /// </summary>
    public bool IsKtivDifferentThanQri => Type == SegmentType.Ktiv && PairedOffset.HasValue && PairedOffset.Value != 0;

    /// <summary>
    /// Whether the segment ends with a maqaf (Hebrew hyphen).
    /// </summary>
    public bool EndsWithMaqaf => Value.Length > 0 && Value[^1] == '־';
}

/// <summary>
/// Types of segments within a pasuk.
/// </summary>
public enum SegmentType
{
    /// <summary>Ktiv segment (written text, may differ from qri).</summary>
    Ktiv,
    /// <summary>Qri segment (read text, vocalized).</summary>
    Qri,
    /// <summary>Parsha marker פתוחה (open paragraph).</summary>
    Ptuha,
    /// <summary>Parsha marker סתומה (closed paragraph).</summary>
    Stuma
}

/// <summary>
/// Represents a component within a pasuk (text segment or special marker).
/// </summary>
public class PasukComponent
{
    /// <summary>
    /// The type of component (Text, Samech, Peh, etc.).
    /// </summary>
    public PasukComponentType Type { get; set; }

    /// <summary>
    /// The text content of this component.
    /// </summary>
    public string Content { get; set; } = string.Empty;
}

/// <summary>
/// Types of components within a pasuk.
/// </summary>
public enum PasukComponentType
{
    /// <summary>Regular text content.</summary>
    Text,
    /// <summary>Parsha marker {ס} - Setuma (closed).</summary>
    Samech,
    /// <summary>Parsha marker {פ} - Petucha (open).</summary>
    Peh,
    /// <summary>Nun Hafucha marker.</summary>
    NunHafucha
}
