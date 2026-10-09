using Microsoft.Maui.Graphics;

namespace BibleOnSite.Helpers;

/// <summary>
/// Geometry for the reader's expandable bottom menu — the fan of action buttons
/// around the central toggle inside <c>FloatingMenuContainer</c>.
///
/// Actions are placed on an elliptical arc centered on the toggle button:
/// their horizontal offsets are spaced uniformly and their heights follow the
/// ellipse <c>(dx/rx)² + (dy/ry)² = 1</c>. The radii are fixed in
/// device-independent units rather than proportional to the window, so the fan
/// keeps one compact, centered shape in portrait, landscape and on tablets
/// instead of spreading across the window width. Radii adapt only when the
/// canvas is too small for the preferred arc, and a final pass guarantees
/// every action stays inside the canvas, off the toggle, and off the fixed
/// bottom-bar buttons.
/// </summary>
public static class FanMenuGeometry
{
    /// <summary>Action button diameter (the satellite buttons in PerekPage.xaml).</summary>
    public static double ItemSize { get; } = 48;

    /// <summary>Central open/close button diameter.</summary>
    public static double ToggleSize { get; } = 56;

    /// <summary>Bottom-bar height (BottomBar HeightRequest).</summary>
    public static double BarHeight { get; } = 90;

    /// <summary>Bottom-bar button size.</summary>
    public static double BarButtonSize { get; } = 44;

    /// <summary>Vertical proportional position of the bar buttons inside the bar.</summary>
    public static double BarButtonVerticalFraction { get; } = 0.55;

    /// <summary>Horizontal proportional positions of the bar buttons inside the bar.</summary>
    public static IReadOnlyList<double> BarButtonHorizontalFractions { get; } =
        [0.08, 0.28, 0.72, 0.92];

    /// <summary>Preferred horizontal radius of the fan ellipse, in dp.</summary>
    public static double PreferredRadiusX { get; } = 98;

    /// <summary>Preferred vertical radius of the fan ellipse, in dp.</summary>
    public static double PreferredRadiusY { get; } = 64;

    /// <summary>Half-spread of the fan, measured from the vertical axis.</summary>
    public static double MaxAngleDegrees { get; } = 60;

    /// <summary>Distance between the toggle's bottom edge and the canvas bottom edge.</summary>
    public static double ToggleBottomClearance { get; } = 34;

    /// <summary>
    /// |dx| below this is treated as "on the fan axis" — the middle action of an
    /// odd count stays centered instead of being pushed aside.
    /// </summary>
    private const double OnAxisEpsilon = 1e-9;

    private const double EdgeMargin = 6;
    private const double TopMargin = 6;
    private const double ItemGap = 8;
    private const double ToggleGap = 4;
    private const double ObstacleGap = 4;
    private const double DegToRad = Math.PI / 180;
    private const int MaxSeparationPasses = 16;
    private const int MaxResolveRounds = 8;
    private const int FixedResolveRounds = 3;

    /// <summary>
    /// The computed menu layout: the toggle bounds, the action bounds (ordered
    /// left-to-right) and the bottom-bar obstacle bounds the actions must avoid.
    /// All rectangles share the same canvas coordinate space.
    /// </summary>
    public sealed record Result(
        Rect Toggle,
        IReadOnlyList<Rect> Items,
        IReadOnlyList<Rect> Obstacles);

    /// <summary>
    /// Computes the menu layout for a canvas of <paramref name="width"/> x
    /// <paramref name="height"/> device-independent units — the arrange area of
    /// <c>FloatingMenuContainer</c> (its size minus padding, so system safe-area
    /// insets applied as padding are already excluded) — for the reader's four
    /// action buttons.
    /// </summary>
    public static Result Compute(double width, double height) =>
        Compute(width, height, 4);

    /// <inheritdoc cref="Compute(double, double)"/>
    /// <param name="itemCount">Number of action buttons to place on the fan.</param>
    public static Result Compute(double width, double height, int itemCount)
    {
        var toggle = ToggleBounds(width, height);
        var obstacles = ObstacleBounds(width, height);
        var items = ActionPositions(toggle.Center, width, height, itemCount, toggle, obstacles);
        return new Result(toggle, items, obstacles);
    }

    /// <summary>
    /// The toggle button bounds: centered horizontally, a fixed
    /// <see cref="ToggleBottomClearance"/> above the canvas bottom edge, so it
    /// stays seated in the bottom-bar notch at any window size.
    /// </summary>
    public static Rect ToggleBounds(double width, double height) =>
        new(width / 2 - ToggleSize / 2, height - ToggleBottomClearance - ToggleSize,
            ToggleSize, ToggleSize);

    /// <summary>
    /// The bottom-bar button bounds the actions may not cover, expressed in the
    /// same canvas space. Mirrors the bar's <c>PositionProportional</c> layout:
    /// a proportional anchor f puts the child's edge at f·(extent − childSize).
    /// </summary>
    public static IReadOnlyList<Rect> ObstacleBounds(double width, double height)
    {
        var barTop = height - BarHeight;
        var buttonTop = barTop + BarButtonVerticalFraction * (BarHeight - BarButtonSize);
        var obstacles = new List<Rect>(BarButtonHorizontalFractions.Count);
        foreach (var fraction in BarButtonHorizontalFractions)
        {
            obstacles.Add(new Rect(
                fraction * (width - BarButtonSize), buttonTop,
                BarButtonSize, BarButtonSize));
        }
        return obstacles;
    }

    private static List<Rect> ActionPositions(
        Point center, double width, double height, int count,
        Rect toggle, IReadOnlyList<Rect> obstacles)
    {
        var items = new List<Rect>(Math.Max(count, 0));
        if (count < 1 || width <= 0 || height <= 0)
        {
            return items;
        }

        var itemHalf = ItemSize / 2;

        // 1. Horizontal radius: the fan never widens past PreferredRadiusX —
        //    the group stays compact and centered on huge landscape/tablet
        //    windows — and shrinks only to keep the actions inside the canvas.
        var rx = Math.Min(PreferredRadiusX,
            Math.Max(Math.Min(center.X, width - center.X) - itemHalf - EdgeMargin, itemHalf));

        // 2. Vertical radius: capped so the topmost action stays inside the
        //    canvas top margin.
        var maxRise = center.Y - TopMargin - itemHalf;
        var ry = Math.Max(Math.Min(PreferredRadiusY, maxRise), itemHalf);

        // 3. Horizontal offsets, uniform between ±dxOuter. The innermost offset
        //    keeps at least (ItemSize + ItemGap)/2 so the closest pair remains
        //    individually tappable; the outermost is capped so the lowest
        //    action still rises above the fixed bottom-bar buttons.
        var dxOuter = rx * Math.Sin(MaxAngleDegrees * DegToRad);
        var minRiseObstacles = MinRiseToClear(center.Y, ObstaclesTop(height));
        dxOuter = Math.Min(dxOuter, EllipseX(rx, ry, minRiseObstacles));
        var dxInner = Math.Min((ItemSize + ItemGap) / 2, dxOuter);

        // 4. An action inside the toggle's horizontal band must either rise
        //    above the toggle or step past it horizontally.
        var toggleClearance = (ToggleSize + ItemSize) / 2 + ToggleGap;
        if (dxInner < toggleClearance && EllipseY(rx, ry, dxInner) < toggleClearance)
        {
            dxInner = Math.Min(toggleClearance, dxOuter);
        }

        // 5. Positions on the ellipse.
        foreach (var dx in SpreadOffsets(count, dxInner, dxOuter))
        {
            var x = center.X + dx;
            var y = center.Y - EllipseY(rx, ry, dx);
            items.Add(new Rect(x - itemHalf, y - itemHalf, ItemSize, ItemSize));
        }

        // 7. Safety pass: clamp inside the canvas, lift off the obstacles and
        //    the toggle, then separate any residual overlaps. A no-op wherever
        //    the arc already satisfies every constraint; on degenerate canvases
        //    it trades fan shape for correctness.
        ResolveCollisions(items, toggle, obstacles, width, height);
        return items;
    }

    /// <summary>Ellipse ordinate: the rise above the center at horizontal offset dx.</summary>
    private static double EllipseY(double rx, double ry, double dx) =>
        ry * Math.Sqrt(Math.Max(0, 1 - dx * dx / (rx * rx)));

    /// <summary>Largest |dx| whose ellipse rise still reaches <paramref name="minRise"/>.</summary>
    private static double EllipseX(double rx, double ry, double minRise)
    {
        var squared = 1 - minRise * minRise / (ry * ry);
        return squared <= 0 ? 0 : rx * Math.Sqrt(squared);
    }

    /// <summary>
    /// Horizontal action offsets: uniformly spaced in [-dxOuter, +dxOuter] with
    /// the closest pair to the axis kept at least <paramref name="dxInner"/> out
    /// so they don't merge into one wide touch target. Odd counts place one
    /// action on the axis itself.
    /// </summary>
    private static IEnumerable<double> SpreadOffsets(int count, double dxInner, double dxOuter)
    {
        if (count == 1)
        {
            yield return 0;
            yield break;
        }

        for (var i = 0; i < count; i++)
        {
            var dx = -dxOuter + 2 * dxOuter * i / (count - 1);
            if (Math.Abs(dx) >= OnAxisEpsilon && Math.Abs(dx) < dxInner)
            {
                dx = Math.CopySign(dxInner, dx);
            }
            yield return dx;
        }
    }

    /// <summary>Top edge of the bottom-bar buttons within the canvas.</summary>
    private static double ObstaclesTop(double height) =>
        height - BarHeight + BarButtonVerticalFraction * (BarHeight - BarButtonSize);

    /// <summary>
    /// Rise above the toggle center needed for an action's bottom edge to clear
    /// an obstacle band whose top edge is <paramref name="obstaclesTop"/>.
    /// </summary>
    private static double MinRiseToClear(double centerY, double obstaclesTop) =>
        centerY - obstaclesTop + ItemSize / 2 + ObstacleGap;

    private static void ResolveCollisions(
        List<Rect> items, Rect toggle, IReadOnlyList<Rect> obstacles,
        double width, double height)
    {
        // Fixed-control resolution and pair separation alternate: pushes can
        // shove an action onto an obstacle while lifts/sidesteps can re-merge
        // pairs, so neither pass alone converges. A few rounds are enough on
        // real canvases; canvases that cannot fit the fan fall through to the
        // grid below.
        for (var round = 0; round < MaxResolveRounds; round++)
        {
            var changed = ResolveFixed(items, toggle, obstacles, width, height);
            changed |= SeparatePairs(items, width, height);
            if (!changed)
            {
                break;
            }
        }

        // Last resort for canvases too narrow for the fan: stack the actions
        // in a compact grid above the toggle so every touch target stays
        // distinct, then settle the result like any other arrangement.
        if (AnyPairOverlaps(items))
        {
            GridStack(items, toggle, width, height);
            for (var round = 0; round < MaxResolveRounds; round++)
            {
                var changed = ResolveFixed(items, toggle, obstacles, width, height);
                changed |= SeparatePairs(items, width, height);
                if (!changed)
                {
                    break;
                }
            }

            // Fixed controls have priority over pair separation: on degenerate
            // canvases a residual pair overlap is preferable to covering a
            // fixed control or leaving the safe area.
            ResolveFixed(items, toggle, obstacles, width, height);
        }
    }

    /// <summary>
    /// Clamps every action into the canvas and moves it off the obstacles and
    /// the toggle.
    /// </summary>
    /// <returns>True when any action moved.</returns>
    private static bool ResolveFixed(
        List<Rect> items, Rect toggle, IReadOnlyList<Rect> obstacles,
        double width, double height)
    {
        var changed = false;
        for (var i = 0; i < items.Count; i++)
        {
            var resolved = ResolveFixedCollisions(items[i], toggle, obstacles,
                width, height);
            if (!resolved.Equals(items[i]))
            {
                items[i] = resolved;
                changed = true;
            }
        }
        return changed;
    }

    /// <summary>
    /// Resolves a single action against the fixed controls. Escaping one
    /// blocker sideways can land the action on the next one, so the pass
    /// repeats until the rect stabilizes.
    /// </summary>
    private static Rect ResolveFixedCollisions(
        Rect rect, Rect toggle, IReadOnlyList<Rect> obstacles,
        double width, double height)
    {
        for (var round = 0; round < FixedResolveRounds; round++)
        {
            var resolved = ClampToCanvas(rect, width, height);
            foreach (var obstacle in obstacles)
            {
                if (resolved.IntersectsWith(obstacle))
                {
                    resolved = EscapeBlocker(resolved, obstacle, ObstacleGap);
                }
            }
            if (resolved.IntersectsWith(toggle))
            {
                resolved = EscapeBlocker(resolved, toggle, ToggleGap);
            }
            resolved = ClampToCanvas(resolved, width, height);
            if (resolved.Equals(rect))
            {
                return resolved;
            }
            rect = resolved;
        }
        return rect;
    }

    /// <summary>
    /// Moves an action off a fixed control: above it when the canvas has room
    /// (the fan lives in the upper half around the toggle), otherwise beside
    /// it — a short canvas may lack the vertical space to lift an action but
    /// almost always has horizontal room next to the control.
    /// </summary>
    private static Rect EscapeBlocker(Rect rect, Rect blocker, double gap)
    {
        var liftedY = Math.Min(rect.Y, blocker.Top - gap - ItemSize);
        if (liftedY >= TopMargin)
        {
            return new Rect(rect.X, liftedY, ItemSize, ItemSize);
        }

        // The clamped lift may still clear a low blocker (e.g. a bar button on
        // a very short canvas): prefer it over moving sideways.
        if (TopMargin + ItemSize <= blocker.Top)
        {
            return new Rect(rect.X, TopMargin, ItemSize, ItemSize);
        }

        var leftX = blocker.Left - gap - ItemSize;
        var rightX = blocker.Right + gap;
        var moveLeft = Math.Abs(rect.X - leftX);
        var moveRight = Math.Abs(rect.X - rightX);
        var x = moveLeft <= moveRight ? leftX : rightX;
        return new Rect(x, rect.Y, ItemSize, ItemSize);
    }

    /// <summary>
    /// Pushes overlapping pairs apart along their cheaper separation axis.
    /// Actions are ordered left-to-right, so a horizontal push keeps the
    /// visual order; a vertical push stacks them. When the cheaper axis is
    /// wedged against a canvas edge (the push gets clamped away), the other
    /// axis still gets a try — narrow windows cannot always separate four
    /// actions horizontally. Iterates because one resolution can create the
    /// next overlap on crowded canvases.
    /// </summary>
    /// <returns>True when any action moved.</returns>
    private static bool SeparatePairs(List<Rect> items, double width, double height)
    {
        var anyMoved = false;
        for (var pass = 0; pass < MaxSeparationPasses; pass++)
        {
            var moved = false;
            for (var i = 0; i < items.Count; i++)
            {
                for (var j = i + 1; j < items.Count; j++)
                {
                    var a = items[i];
                    var b = items[j];
                    var overlapX = Overlap(a, b, horizontal: true);
                    var overlapY = Overlap(a, b, horizontal: false);
                    if (overlapX <= -ItemGap || overlapY <= -ItemGap)
                    {
                        continue;
                    }

                    moved = anyMoved = true;
                    var horizontal = overlapX <= overlapY;
                    (a, b) = PushPair(a, b, overlapX, overlapY, horizontal);
                    a = ClampToCanvas(a, width, height);
                    b = ClampToCanvas(b, width, height);

                    // The preferred axis may be pinned at a canvas edge: give
                    // the other axis a try only while the pair still actually
                    // intersects — partial separation converges on later passes.
                    if (Overlap(a, b, horizontal: true) > 0 &&
                        Overlap(a, b, horizontal: false) > 0)
                    {
                        (a, b) = PushPair(a, b,
                            Overlap(a, b, horizontal: true),
                            Overlap(a, b, horizontal: false), !horizontal);
                        a = ClampToCanvas(a, width, height);
                        b = ClampToCanvas(b, width, height);
                    }

                    items[i] = a;
                    items[j] = b;
                }
            }

            if (!moved)
            {
                break;
            }
        }
        return anyMoved;
    }

    /// <summary>Signed overlap of two action rects on one axis (negative = gap).</summary>
    private static double Overlap(Rect a, Rect b, bool horizontal) => horizontal
        ? Math.Min(a.Right, b.Right) - Math.Max(a.Left, b.Left)
        : Math.Min(a.Bottom, b.Bottom) - Math.Max(a.Top, b.Top);

    /// <summary>Separates a pair by half the needed clearance on each side.</summary>
    private static (Rect, Rect) PushPair(
        Rect a, Rect b, double overlapX, double overlapY, bool horizontal)
    {
        if (horizontal)
        {
            var push = (overlapX + ItemGap) / 2;
            var sign = a.Left <= b.Left ? 1 : -1;
            return (new Rect(a.X - push * sign, a.Y, ItemSize, ItemSize),
                    new Rect(b.X + push * sign, b.Y, ItemSize, ItemSize));
        }

        var vertical = (overlapY + ItemGap) / 2;
        var signV = a.Top <= b.Top ? 1 : -1;
        return (new Rect(a.X, a.Y - vertical * signV, ItemSize, ItemSize),
                new Rect(b.X, b.Y + vertical * signV, ItemSize, ItemSize));
    }

    /// <summary>Any pair of actions closer than <see cref="ItemGap"/> on both axes.</summary>
    private static bool AnyPairOverlaps(List<Rect> items)
    {
        for (var i = 0; i < items.Count; i++)
        {
            for (var j = i + 1; j < items.Count; j++)
            {
                if (Overlap(items[i], items[j], horizontal: true) > -ItemGap &&
                    Overlap(items[i], items[j], horizontal: false) > -ItemGap)
                {
                    return true;
                }
            }
        }
        return false;
    }

    /// <summary>
    /// Arranges the actions in centered rows above the toggle — the fallback
    /// for canvases too narrow to hold even the reduced fan horizontally.
    /// </summary>
    private static void GridStack(
        List<Rect> items, Rect toggle, double width, double height)
    {
        var cols = Math.Max(1,
            (int)((width - 2 * EdgeMargin + ItemGap) / (ItemSize + ItemGap)));
        for (var i = 0; i < items.Count; i++)
        {
            var row = i / cols;
            var col = i % cols;
            var rowCount = Math.Min(cols, items.Count - row * cols);
            var rowWidth = rowCount * ItemSize + (rowCount - 1) * ItemGap;
            var x = (width - rowWidth) / 2 + col * (ItemSize + ItemGap);
            var y = toggle.Top - ToggleGap - ItemSize - row * (ItemSize + ItemGap);
            items[i] = ClampToCanvas(new Rect(x, y, ItemSize, ItemSize), width, height);
        }
    }

    private static Rect ClampToCanvas(Rect rect, double width, double height)
    {
        var x = Math.Clamp(rect.X, EdgeMargin,
            Math.Max(EdgeMargin, width - ItemSize - EdgeMargin));
        var y = Math.Clamp(rect.Y, TopMargin,
            Math.Max(TopMargin, height - ItemSize - EdgeMargin));
        return new Rect(x, y, ItemSize, ItemSize);
    }
}
