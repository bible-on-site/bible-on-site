namespace BibleOnSite.Helpers;

/// <summary>
/// Unit-agnostic rectangle used by <see cref="WindowPlacementPlan"/> so the
/// math can be unit-tested without WinUI types.
/// </summary>
public readonly record struct DesktopRect(double X, double Y, double Width, double Height);

/// <summary>
/// Pure planning logic for the Windows window's initial/restore placement
/// (#2766). The platform layer converts between dips and physical pixels;
/// everything here is expressed in the caller's unit of choice.
/// </summary>
public static class WindowPlacementPlan
{
    /// <summary>Smallest window size that still keeps the shell usable.</summary>
    public static double MinWindowWidth { get; } = 460;
    public static double MinWindowHeight { get; } = 560;

    /// <summary>Default first-run window size (desktop-class, not maximized).</summary>
    public static double DefaultWindowWidth { get; } = 1140;
    public static double DefaultWindowHeight { get; } = 840;

    /// <summary>
    /// How many dips of the window must stay inside the work area when
    /// restoring a saved rectangle, so a disconnected monitor or a DPI
    /// change can never strand the window off-screen.
    /// </summary>
    public static double MinVisibleEdge { get; } = 80;

    /// <summary>
    /// Placement used on first run (no saved bounds): a desktop-class
    /// window centered in the work area, never smaller than the minimum
    /// and never larger than the work area itself.
    /// </summary>
    public static DesktopRect InitialPlacement(DesktopRect workArea)
    {
        var width = Math.Clamp(workArea.Width - 80, MinWindowWidth, DefaultWindowWidth);
        var height = Math.Clamp(workArea.Height - 60, MinWindowHeight, DefaultWindowHeight);
        return new DesktopRect(
            workArea.X + ((workArea.Width - width) / 2),
            workArea.Y + ((workArea.Height - height) / 2),
            width,
            height);
    }

    /// <summary>
    /// Clamps a saved rectangle so it is usable on the current work area:
    /// keeps at least <see cref="MinVisibleEdge"/> of the title bar on
    /// screen and shrinks the window if the work area got smaller (e.g. an
    /// external monitor was unplugged or the taskbar grew).
    /// </summary>
    public static DesktopRect ClampToWorkArea(DesktopRect bounds, DesktopRect workArea)
    {
        var width = Math.Clamp(bounds.Width, MinWindowWidth, Math.Max(workArea.Width, MinWindowWidth));
        var height = Math.Clamp(bounds.Height, MinWindowHeight, Math.Max(workArea.Height, MinWindowHeight));

        var x = Math.Clamp(bounds.X, workArea.X + MinVisibleEdge - width, workArea.X + workArea.Width - MinVisibleEdge);
        var y = Math.Clamp(bounds.Y, workArea.Y, workArea.Y + workArea.Height - MinVisibleEdge);

        return new DesktopRect(x, y, width, height);
    }

    /// <summary>True when the two rectangles share any area or edge.</summary>
    public static bool Intersects(DesktopRect a, DesktopRect b)
        => a.X < b.X + b.Width && a.X + a.Width > b.X
           && a.Y < b.Y + b.Height && a.Y + a.Height > b.Y;

    /// <summary>Intersection area of two rectangles (0 when disjoint).</summary>
    public static double IntersectionArea(DesktopRect a, DesktopRect b)
    {
        var width = Math.Max(0, Math.Min(a.X + a.Width, b.X + b.Width) - Math.Max(a.X, b.X));
        var height = Math.Max(0, Math.Min(a.Y + a.Height, b.Y + b.Height) - Math.Max(a.Y, b.Y));
        return width * height;
    }

    /// <summary>
    /// Clamps a saved rectangle to the work area it overlaps most, so even a
    /// one-pixel edge on a still-connected display keeps a grabbable
    /// <see cref="MinVisibleEdge"/> on screen. Falls back to
    /// <paramref name="fallback"/> when no work area intersects at all.
    /// </summary>
    public static DesktopRect ClampToBestDisplay(
        DesktopRect bounds, IReadOnlyList<DesktopRect> workAreas, DesktopRect fallback)
    {
        var best = fallback;
        var bestOverlap = 0d;
        foreach (var workArea in workAreas)
        {
            var overlap = IntersectionArea(bounds, workArea);
            if (overlap > bestOverlap)
            {
                bestOverlap = overlap;
                best = workArea;
            }
        }
        return ClampToWorkArea(bounds, bestOverlap > 0 ? best : fallback);
    }

    /// <summary>
    /// Serializes a saved rectangle plus the maximized flag in the stable
    /// <c>"x,y,w,h|m"</c> format stored in Preferences.
    /// </summary>
    public static string Serialize(DesktopRect bounds, bool maximized)
        => FormattableString.Invariant($"{bounds.X},{bounds.Y},{bounds.Width},{bounds.Height}|{(maximized ? 1 : 0)}");

    /// <summary>
    /// Parses a value produced by <see cref="Serialize"/>. Returns false
    /// for anything malformed, missing, or non-finite so a corrupt
    /// preference silently falls back to the default placement.
    /// </summary>
    public static bool TryParse(string? value, out DesktopRect bounds, out bool maximized)
    {
        bounds = default;
        maximized = false;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var parts = value.Split('|');
        if (parts.Length != 2 || parts[1] is not ("0" or "1"))
        {
            return false;
        }

        var nums = parts[0].Split(',');
        if (nums.Length != 4)
        {
            return false;
        }

        var parsed = new double[4];
        for (var i = 0; i < nums.Length; i++)
        {
            if (!double.TryParse(nums[i], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out parsed[i])
                || !double.IsFinite(parsed[i]))
            {
                return false;
            }
        }

        bounds = new DesktopRect(parsed[0], parsed[1], parsed[2], parsed[3]);
        maximized = parts[1] == "1";
        return bounds.Width > 0 && bounds.Height > 0;
    }
}
