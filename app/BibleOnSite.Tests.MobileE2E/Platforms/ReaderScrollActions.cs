using System.Drawing;
using OpenQA.Selenium.Interactions;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

internal static class ReaderScrollActions
{
    internal static ActionSequence ReturnToHeading(Rectangle reader, Size window, Rectangle? heading)
    {
        var viewport = Rectangle.Intersect(reader, new Rectangle(Point.Empty, window));
        if (viewport.Width < 4 || viewport.Height < 4)
        {
            throw new ArgumentOutOfRangeException(nameof(reader), "The reader must intersect the actual viewport.");
        }
        // The gutter belongs to the outer reader, rather than selectable text
        // or links in the nested commentary UITextView.
        var x = viewport.Left + Math.Min(4, viewport.Width / 4);
        var margin = Math.Max(1, viewport.Height / 5);
        var top = viewport.Top + margin;
        var bottom = viewport.Bottom - margin;
        var range = bottom - top;
        var delta = heading is { } target
            ? viewport.Top + viewport.Height / 3.0 - (target.Top + target.Height / 2.0)
            : range;
        var distance = (int)Math.Clamp(Math.Round(delta), -range, range);
        if (distance == 0) { distance = Math.Min(32, range); }
        var fromY = distance > 0 ? top : bottom;
        var finger = new PointerInputDevice(PointerKind.Touch, "reader-scroll");
        var gesture = new ActionSequence(finger, 0);
        gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, fromY, TimeSpan.Zero));
        gesture.AddAction(finger.CreatePointerDown(MouseButton.Left));
        gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, fromY + distance, TimeSpan.FromMilliseconds(350)));
        gesture.AddAction(finger.CreatePointerUp(MouseButton.Left));
        return gesture;
    }
}
