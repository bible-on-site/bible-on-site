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
        var notchWidth = 80f;
        var notchDepth = 24f;
        var curveStart = (width - notchWidth) / 2f;
        var curveEnd = (width + notchWidth) / 2f;

        // Determine if dark mode
        var isDarkMode = Application.Current?.RequestedTheme == AppTheme.Dark;
        var barColor = isDarkMode ? Color.FromArgb("#1C1C1E") : Colors.White;

        // Create path for the bar with curved notch
        var path = new PathF();

        // Start from top-left with subtle curve
        path.MoveTo(0, notchDepth);
        path.QuadTo(width * 0.18f, 0, curveStart - 20, 0);

        // Left curve into notch
        path.QuadTo(curveStart - 5, 0, curveStart, notchDepth - 5);

        // Notch arc (semi-circle going down into the bar)
        path.CurveTo(
            curveStart + notchWidth * 0.2f, notchDepth + 12,
            curveEnd - notchWidth * 0.2f, notchDepth + 12,
            curveEnd, notchDepth - 5
        );

        // Right curve out of notch
        path.QuadTo(curveEnd + 5, 0, curveEnd + 20, 0);

        // Top-right curve
        path.QuadTo(width * 0.82f, 0, width, notchDepth);

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
