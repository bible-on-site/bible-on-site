using System.Drawing;
using OpenQA.Selenium.Interactions;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

internal static class ReaderScrollActions
{
    // A lift-free flick leaves the collection decelerating; on iOS momentum
    // keeps prefetch/recycle churning on the main thread for tens of seconds,
    // which is what starves every WDA command issued during the drain. One
    // short, slow drag takes scroll tracking and stops the inertia without a
    // tap (no link or selection risk in the commentary text view).
    internal static ActionSequence Brake(Rectangle reader, Size window)
    {
        var viewport = Viewport(reader, window);
        var x = viewport.Left + Math.Min(4, viewport.Width / 4);
        var centerY = viewport.Top + viewport.Height / 2;
        var travel = Math.Clamp(viewport.Height / 16, 8, 32);
        var finger = new PointerInputDevice(PointerKind.Touch, "reader-brake");
        var gesture = new ActionSequence(finger, 0);
        gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, centerY - travel / 2, TimeSpan.Zero));
        gesture.AddAction(finger.CreatePointerDown(MouseButton.Left));
        gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, centerY + travel / 2, TimeSpan.FromMilliseconds(120)));
        gesture.AddAction(finger.CreatePointerUp(MouseButton.Left));
        return gesture;
    }

    internal static ActionSequence ReturnToHeading(Rectangle reader, Size window, Rectangle? heading)
    {
        var viewport = Viewport(reader, window);
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

    private static Rectangle Viewport(Rectangle reader, Size window)
    {
        var viewport = Rectangle.Intersect(reader, new Rectangle(Point.Empty, window));
        if (viewport.Width < 4 || viewport.Height < 4)
        {
            throw new ArgumentOutOfRangeException(nameof(reader), "The reader must intersect the actual viewport.");
        }
        return viewport;
    }
}
