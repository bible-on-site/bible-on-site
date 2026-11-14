using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

/// <summary>
/// The single authority for user-facing learning-cycle labels (#2725):
/// "מחזור ד'" style names with Hebrew display numerals, the " (משוער)"
/// marker on projected cycles, and the start/end date range. Numeric cycle
/// values stay numeric everywhere else — picker values, artifact keys and
/// URLs. Mirrors the website's getCycleName/getCycleLabel so both platforms
/// render the same labels.
/// </summary>
public static class CycleDisplayFormatter
{
    /// <summary>"מחזור ד'" or "מחזור י"א (משוער)".</summary>
    public static string Name(PerekScheduleService.StudyCycle cycle) =>
        $"מחזור {GimatryHelper.ToDisplayLetters(cycle.Number)}" +
            (cycle.Projected ? " (משוער)" : string.Empty);

    /// <summary>The name plus its Hebrew date range: "מחזור ד': start - end".</summary>
    public static string Label(PerekScheduleService.StudyCycle cycle) =>
        $"{Name(cycle)}: " +
            $"{HebrewDateHelper.FormatHebrewDate(cycle.StartDate)} - " +
            $"{HebrewDateHelper.FormatHebrewDate(cycle.EndDate)}";
}
