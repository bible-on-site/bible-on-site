namespace BibleOnSite.Controls;

/// <summary>
/// Drawable for the bottom navigation bar with a curved center notch.
/// Inspired by the Flutter AlHaperekBottomMenuPainter from the legacy app.
/// </summary>
public class BottomBarDrawable : IDrawable
{
    public void Draw(ICanvas canvas, RectF dirtyRect)
    {
        var width = dirtyRect.Width;
        var height = dirtyRect.Height;
        var notchRadius = 44f; // Wider notch with more spacing around FAB
        var notchDepth = 68f; // Extra deep notch - bottom at ~30% of bar height
        var edgeCurveHeight = 18f; // Height of the curved edges
        var centerX = width / 2f;

        // Clear canvas with transparent background first
        canvas.FillColor = Colors.Transparent;
        canvas.FillRectangle(dirtyRect);

        // Determine if dark mode
        var isDarkMode = Application.Current?.RequestedTheme == AppTheme.Dark;
        var barColor = isDarkMode ? Color.FromArgb("#1C1C1E") : Colors.White;

        // Create path for the bar with curved edges and deep notch
        var path = new PathF();

        // Start from bottom-left, go up to start of left curve
        path.MoveTo(0, height);
        path.LineTo(0, edgeCurveHeight);

        // Left edge curve up and inward toward notch
        path.QuadTo(width * 0.15f, 0, centerX - notchRadius - 20, 0);

        // Smooth curve down into the notch (using cubic bezier for smoother radius)
        path.CurveTo(
            centerX - notchRadius - 5, 0,
            centerX - notchRadius, notchDepth * 0.3f,
            centerX - notchRadius * 0.5f, notchDepth
        );

        // Bottom arc of notch (smooth semi-circle)
        path.CurveTo(
            centerX - notchRadius * 0.15f, notchDepth + 8,
            centerX + notchRadius * 0.15f, notchDepth + 8,
            centerX + notchRadius * 0.5f, notchDepth
        );

        // Smooth curve up out of notch
        path.CurveTo(
            centerX + notchRadius, notchDepth * 0.3f,
            centerX + notchRadius + 5, 0,
            centerX + notchRadius + 20, 0
        );

        // Right edge curve up and outward
        path.QuadTo(width * 0.85f, 0, width, edgeCurveHeight);

        // Right side down
        path.LineTo(width, height);

        // Bottom
        path.LineTo(0, height);

        // Close back to start
        path.Close();

        // Draw shadow
        canvas.SetShadow(new SizeF(0, -2), 6, Colors.Black.WithAlpha(0.12f));

        // Fill the path
        canvas.SetFillPaint(new SolidPaint(barColor), dirtyRect);
        canvas.FillPath(path);
    }
}
