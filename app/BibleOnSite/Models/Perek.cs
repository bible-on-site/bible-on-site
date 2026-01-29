namespace BibleOnSite.Models;

/// <summary>
/// Represents a Perek (chapter) in the 929 learning cycle.
/// </summary>
public class Perek
{
    /// <summary>
    /// Unique identifier for this perek in the 929 cycle (1-929).
    /// </summary>
    public int PerekId { get; set; }

    /// <summary>
    /// The additional marker for split books (e.g., 1 for שמואל א, 2 for שמואל ב, 70 for עזרא, 50 for נחמיה).
    /// Null for books without splits.
    /// </summary>
    public int? Additional { get; set; }

    /// <summary>
    /// The Gregorian date for this perek (yyyy-MM-dd format).
    /// </summary>
    public required string Date { get; set; }

    /// <summary>
    /// Whether this perek has an audio recording available.
    /// </summary>
    public bool HasRecording { get; set; }

    /// <summary>
    /// Header/title text for this perek.
    /// </summary>
    public string Header { get; set; } = string.Empty;

    /// <summary>
    /// The Hebrew date string (formatted for display).
    /// </summary>
    public required string HebDate { get; set; }

    /// <summary>
    /// The Hebrew date in numeric format YYYYMMDD for comparison.
    /// </summary>
    public int HebDateNumeric { get; set; }

    /// <summary>
    /// The perek number within the sefer.
    /// </summary>
    public int PerekNumber { get; set; }

    /// <summary>
    /// The ID of the sefer this perek belongs to.
    /// </summary>
    public int SeferId { get; set; }

    /// <summary>
    /// The Hebrew name of the sefer.
    /// </summary>
    public required string SeferName { get; set; }

    /// <summary>
    /// The English transliteration name of the sefer.
    /// </summary>
    public required string SeferTanahUsName { get; set; }

    /// <summary>
    /// The tzeis hakochavim (nightfall) time for this date (HH:mm:ss format).
    /// </summary>
    public required string Tseit { get; set; }

    /// <summary>
    /// The count of articles available for this perek.
    /// </summary>
    public int ArticlesCount { get; set; }

    /// <summary>
    /// The pasukim (verses) within this perek.
    /// </summary>
    public List<Pasuk> Pasukim { get; set; } = new();
}
