namespace BibleOnSite.Helpers;

/// <summary>
/// Shared display policy for the persisted reading metrics (issue #2607) —
/// the Hebrew mirror of the website's formatEstimatedReadingTime
/// (web/bible-on-site/src/lib/reading-metrics/format.ts). The estimate is a
/// silent-reading baseline, not required learning time, recitation length or
/// measured reader performance — hence the hedged label.
/// </summary>
public static class ReadingTimeFormatter
{
    /// <summary>Canonical UI label for the estimate.</summary>
    public static string EstimateLabel => "זמן קריאה משוער";

    private const int SecondsPerMinute = 60;

    /// <summary>
    /// Format the stored estimatedSeconds for display.
    /// null (unknown) and 0 (verified-empty) return null — never fabricate a
    /// minute. Under 60s shows "פחות מדקה"; otherwise whole minutes rounded up.
    /// </summary>
    public static string? FormatEstimatedReadingTime(int? estimatedSeconds)
    {
        if (!estimatedSeconds.HasValue || estimatedSeconds.Value <= 0)
        {
            return null;
        }
        if (estimatedSeconds.Value < SecondsPerMinute)
        {
            return "פחות מדקה";
        }
        var minutes = (int)Math.Ceiling(estimatedSeconds.Value / (double)SecondsPerMinute);
        return minutes == 1 ? "דקה" : $"{minutes} דקות";
    }

    /// <summary>Full badge text ("זמן קריאה משוער: X") or null when nothing to show.</summary>
    public static string? FormatReadingTimeLabel(int? estimatedSeconds)
    {
        var formatted = FormatEstimatedReadingTime(estimatedSeconds);
        return formatted == null ? null : $"{EstimateLabel}: {formatted}";
    }
}
