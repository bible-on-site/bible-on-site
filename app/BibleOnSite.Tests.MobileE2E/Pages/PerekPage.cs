using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Pages;

public sealed class PerekPage(AppiumDriver driver, MobilePlatformAdapter platform)
{
    public void WaitForStartup() => WaitForStartup(TimeSpan.FromSeconds(45));

    // Instrumented iOS startup spends part of the same budget waiting for the
    // reader's non-accessibility readiness signal before its first snapshot.
    public void WaitForStartup(TimeSpan remaining) => WaitFor("PerekSource",
        element => !string.IsNullOrWhiteSpace(element.Text), remaining);

    public AppiumElement WaitFor(string automationId) => WaitFor(automationId, _ => true);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition) =>
        WaitFor(platform.AutomationId(automationId), condition);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition, TimeSpan timeout) =>
        WaitFor(platform.AutomationId(automationId), condition, timeout);

    public AppiumElement WaitFor(By locator) => WaitFor(locator, _ => true);

    public AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition) =>
        WaitFor(locator, condition, TimeSpan.FromSeconds(45));

    private AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var element = FindVisible(locator, condition).FirstOrDefault();
                if (element != null)
                {
                    return element.Element;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // An observation timeout can retry within this deadline.
                // Appium's session-ending proxy timeout must reach recovery.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No visible element matching {locator} met the condition within {timeout.TotalSeconds} seconds.");
    }

    public string Source => WaitForText("PerekSource");
    public string FirstPasuk => WaitForText("PasukText");

    private string WaitForText(string automationId)
    {
        string text = string.Empty;
        // Capture the accepted observation. Reading the returned live element
        // again can race collection recycling after a scroll on iOS.
        WaitFor(automationId, element =>
        {
            text = element.Text;
            return !string.IsNullOrWhiteSpace(text);
        });
        return text;
    }

    /// <summary>
    /// Waits until no element matching the automation id is displayed with its
    /// center inside the viewport. Dismissed flyout content leaves the
    /// accessibility tree entirely on iOS, but a closing animation or a stale
    /// snapshot can keep a copy around briefly.
    /// </summary>
    public void WaitForHidden(string automationId) =>
        WaitForHidden(automationId, TimeSpan.FromSeconds(30));

    /// <inheritdoc cref="WaitForHidden(string)"/>
    public void WaitForHidden(string automationId, TimeSpan timeout)
    {
        var locator = platform.AutomationId(automationId);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var visible = FindVisible(locator).Any();
                if (!visible)
                {
                    return;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // Only observation timeouts retry; dead sessions escape.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"Element matching {locator} stayed visible for {timeout.TotalSeconds} seconds.");
    }

    /// <summary>
    /// Returns the element's frame once two consecutive snapshots agree. A
    /// rotation or a carousel re-snap moves the frame over several layout
    /// passes; measuring during the transition races the assertion.
    /// </summary>
    public (Point Location, Size Size) WaitForStableFrame(string automationId) =>
        WaitForStableFrame(automationId, _ => true);

    /// <inheritdoc cref="WaitForStableFrame(string)"/>
    /// <param name="condition">The accepted candidate's own poll supplies the
    /// frame — on iOS it is the lookup's snapshot, so no live rect request
    /// follows the wait and a recycled view cannot stale the read.</param>
    public (Point Location, Size Size) WaitForStableFrame(string automationId, Func<AppiumElement, bool> condition)
    {
        var locator = platform.AutomationId(automationId);
        var timeout = TimeSpan.FromSeconds(45);
        var deadline = DateTime.UtcNow.Add(timeout);
        var frame = Rectangle.Empty;
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var match = FindVisible(locator, condition).FirstOrDefault();
                if (match != null)
                {
                    if (match.Frame == frame)
                    {
                        return (match.Frame.Location, match.Frame.Size);
                    }
                    frame = match.Frame;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // A straggler lookup retries within the budget.
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException($"The frame of {locator} did not stabilize within {timeout.TotalSeconds} seconds.");
    }

    public void Tap(string automationId) => Tap(platform.AutomationId(automationId));

    public void Tap(string automationId, Func<AppiumElement, bool> condition) =>
        Tap(automationId, condition, TimeSpan.FromSeconds(45));

    public void Tap(string automationId, Func<AppiumElement, bool> condition, TimeSpan timeout) =>
        Tap(platform.AutomationId(automationId), element => condition(element) && platform.CanTap(element), timeout);

    public void DismissPerushimSheet() => DismissPerushimSheet(TimeSpan.FromSeconds(5));

    internal void DismissPerushimSheet(TimeSpan hiddenTimeout)
    {
        By[] markers =
        [
            platform.AutomationId("PerushimContentViewport"),
            platform.AutomationId("PerushCheckBox"),
            platform.AutomationId("PerushimEmptyState")
        ];
        var deadline = DateTime.UtcNow.AddSeconds(45);
        // A row tap may have hit the chevron. Allow the 250ms closing
        // animation to finish before deciding that the sheet needs a tap.
        // Transient lookup failures can use the rest of the observation window.
        var initialTimeout = RemainingTime(hiddenTimeout);
        var settleTime = TimeSpan.FromMilliseconds(Math.Min(350, initialTimeout.TotalMilliseconds));
        if (WaitForDetached(markers, initialTimeout, settleTime))
        {
            return;
        }
        for (var taps = 0; taps < 3 && DateTime.UtcNow < deadline; taps++)
        {
            Tap("PerushimChevronButton", _ => true, RemainingTime(TimeSpan.FromSeconds(10)));
            var timeout = RemainingTime(hiddenTimeout);
            if (WaitForDetached(markers, timeout, timeout))
            {
                return;
            }
        }
        throw new WebDriverTimeoutException("The perushim sheet remained attached after dismissal.");

        TimeSpan RemainingTime(TimeSpan maximum)
        {
            var remaining = deadline - DateTime.UtcNow;
            return remaining < maximum ? remaining : maximum;
        }
    }

    private bool WaitForDetached(IReadOnlyList<By> locators, TimeSpan timeout, TimeSpan settleTime)
    {
        if (timeout <= TimeSpan.Zero)
        {
            return false;
        }
        var start = DateTime.UtcNow;
        var deadline = start.Add(timeout);
        var settledAt = start.Add(settleTime);
        Exception? observationError = null;
        while (true)
        {
            try
            {
                if (!locators.Any(IsPresent))
                {
                    return true;
                }
                if (DateTime.UtcNow >= settledAt)
                {
                    return false;
                }
                observationError = null;
            }
            catch (StaleElementReferenceException exception)
            {
                observationError = exception;
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                observationError = exception;
            }
            var remaining = deadline - DateTime.UtcNow;
            if (remaining <= TimeSpan.Zero)
            {
                break;
            }
            Thread.Sleep(TimeSpan.FromMilliseconds(Math.Min(200, remaining.TotalMilliseconds)));
        }
        if (observationError != null)
        {
            // An inconclusive poll cannot authorize another toggle.
            throw new InvalidOperationException("Could not verify that the perushim sheet was dismissed.", observationError);
        }
        return false;
    }

    public void Tap(By locator) => Tap(locator, platform.CanTap, TimeSpan.FromSeconds(45));

    private void Tap(By locator, Func<AppiumElement, bool> condition, TimeSpan timeout)
    {
        // platform.Tap reads the live frame for the gesture, so a view
        // recycled between the accepting poll and that read resolves again
        // — inside this one budget, never a fresh wait per attempt (#3421).
        var deadline = DateTime.UtcNow.Add(timeout);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var remaining = deadline - DateTime.UtcNow;
            try
            {
                platform.Tap(driver, WaitFor(locator, condition,
                    remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero));
                return;
            }
            catch (StaleElementReferenceException) when (attempt < 2 && remaining > TimeSpan.Zero)
            {
                // The collection is mid-recycle; the next lookup sees a fresh tree.
            }
        }
    }

    /// <summary>
    /// Captures a live property inside the wait's own poll — the same pattern
    /// WaitForText uses for text. Reading the returned element after the wait
    /// races view recycling on iOS; the poll already retries staleness, and on
    /// iOS its snapshot answers text/enabled/displayed/rect without another
    /// device round-trip.
    /// </summary>
    public T WaitForObservation<T>(string automationId, Func<AppiumElement, T> observe) =>
        WaitForObservation(automationId, observe, TimeSpan.FromSeconds(45));

    /// <inheritdoc cref="WaitForObservation{T}(string, Func{AppiumElement, T})"/>
    public T WaitForObservation<T>(string automationId, Func<AppiumElement, T> observe, TimeSpan timeout)
    {
        T observed = default!;
        WaitFor(automationId, element =>
        {
            observed = observe(element);
            return true;
        }, timeout);
        return observed;
    }

    /// <summary>
    /// Waits until an element matching the automation id exists in the
    /// accessibility tree, wherever it sits relative to the viewport. An
    /// element taller than the viewport can never satisfy a center-in-viewport
    /// wait even when its top edge is on screen, and displayed-only lookups
    /// report it not visible for the same reason (#3735).
    /// </summary>
    public void WaitForPresent(string automationId) =>
        WaitForPresent(automationId, TimeSpan.FromSeconds(45));

    /// <inheritdoc cref="WaitForPresent(string)"/>
    public void WaitForPresent(string automationId, TimeSpan timeout)
    {
        var locator = platform.AutomationId(automationId);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                if (IsPresent(locator))
                {
                    return;
                }
            }
            catch (StaleElementReferenceException)
            {
                // A snapshot can reference a node the page just recycled.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // An observation timeout can retry within this deadline.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No element matching {locator} appeared in the accessibility tree within {timeout.TotalSeconds} seconds.");
    }

    private bool IsPresent(By locator) => driver is IosSnapshotDriver snapshots
        ? snapshots.FindSnapshots(locator).Count != 0
        : driver.FindElements(locator).Count != 0;

    /// <summary>
    /// Scrolls the page's own scroll surface until the element's center is
    /// inside the viewport. Deep settings sections (e.g. הסתר שם השם under
    /// תצוגה preferences) never render on a short viewport, so a plain WaitFor
    /// cannot reach them.
    /// </summary>
    public AppiumElement ScrollToVisible(string automationId)
        => ScrollToVisible(automationId, down =>
        {
            if (down)
            {
                platform.ScrollPageDown(driver);
            }
            else
            {
                platform.ScrollPageUp(driver);
            }
        });

    public AppiumElement ScrollFlyoutTo(string automationId)
    {
        var drawer = WaitForObservation("FlyoutScrollView",
            element => new Rectangle(element.Location, element.Size));
        var viewport = Rectangle.Intersect(drawer, new Rectangle(Point.Empty, DriverTelemetry.WindowSize(driver)));
        return ScrollToVisible(automationId, down =>
        {
            // Start inside the RTL drawer so the underlying reader cannot receive the drag.
            var x = viewport.Left + viewport.Width / 2;
            var finger = new PointerInputDevice(PointerKind.Touch, "flyout-scroll");
            var gesture = new ActionSequence(finger, 0);
            gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport,
                x, down ? viewport.Top + viewport.Height * 4 / 5 : viewport.Top + viewport.Height / 5,
                TimeSpan.Zero));
            gesture.AddAction(finger.CreatePointerDown(MouseButton.Left));
            gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport,
                x, down ? viewport.Top + viewport.Height / 5 : viewport.Top + viewport.Height * 4 / 5,
                TimeSpan.FromMilliseconds(350)));
            gesture.AddAction(finger.CreatePointerUp(MouseButton.Left));
            driver.PerformActions([gesture]);
        }, element => viewport.Contains(element.Location.X + element.Size.Width / 2,
            element.Location.Y + element.Size.Height / 2) && platform.CanTap(element));
    }

    private AppiumElement ScrollToVisible(string automationId, Action<bool> scroll, Func<AppiumElement, bool>? condition = null)
    {
        var locator = platform.AutomationId(automationId);
        var deadline = DateTime.UtcNow.AddSeconds(45);
        var scrollingDown = true;
        string? lastSurface = null;
        for (var attempt = 0; attempt < 12 && DateTime.UtcNow < deadline; attempt++)
        {
            try
            {
                var visible = FindVisible(locator, condition).FirstOrDefault();
                if (visible != null)
                {
                    return visible.Element;
                }
                var surface = driver.PageSource;
                scrollingDown = SeekScrollsDown(scrollingDown, lastSurface, surface);
                lastSurface = surface;
                scroll(scrollingDown);
            }
            catch (StaleElementReferenceException)
            {
                // A snapshot can reference a node the page just recycled.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // An observation timeout can retry within this deadline.
            }
        }
        var found = FindVisible(locator, condition).FirstOrDefault();
        if (found != null)
        {
            return found.Element;
        }
        throw new WebDriverTimeoutException($"Scrolling the page never revealed a visible element matching {locator} within 45 seconds.");
    }

    // A single scroll step can carry the target across the viewport — the
    // injected drag releases with fling inertia — and a fully offscreen node
    // is absent from the source tree, so a downward-only seek never recovers
    // an overshot element (#3746's merge-queue ejection). A scroll that
    // leaves the page untouched reached its edge, so the sweep reverses
    // there.
    internal static bool SeekScrollsDown(bool scrollingDown, string? previousSurface, string surface) =>
        surface == previousSurface ? !scrollingDown : scrollingDown;

    /// <summary>
    /// A long commentary hit can land several screens below its heading. Scroll
    /// back to verify the selected commentary before testing reader history.
    /// </summary>
    public AppiumElement ScrollBackTo(string automationId, string text)
    {
        var locator = platform.AutomationIdWithText(automationId, text);
        Func<AppiumElement, bool> condition = element => element.Text == text;
        var deadline = DateTime.UtcNow.AddSeconds(45);
        AppiumElement? reader = null;
        Rectangle? lastHeading = null;
        for (var attempt = 0; attempt < 20 && DateTime.UtcNow < deadline; attempt++)
        {
            try
            {
                var window = DriverTelemetry.WindowSize(driver);
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero) { break; }
                reader ??= WaitFor("PasukimCollection", element => element.Size.Width >= window.Width / 2, remaining);
                NativeElementMatch? target = null;
                if (driver is IosSnapshotDriver snapshots)
                {
                    target = snapshots.FindSnapshots(locator).FirstOrDefault(match =>
                        match.Snapshot.Width > 0 && match.Snapshot.Height > 0
                        && match.Snapshot.X + match.Snapshot.Width / 2 >= 0
                        && match.Snapshot.X + match.Snapshot.Width / 2 < window.Width
                        && condition(match.ConditionElement));
                    lastHeading = target is null ? null : new Rectangle(
                        Convert.ToInt32(target.Snapshot.X), Convert.ToInt32(target.Snapshot.Y),
                        Convert.ToInt32(target.Snapshot.Width), Convert.ToInt32(target.Snapshot.Height));
                }
                else
                {
                    var visible = FindVisible(locator, condition).FirstOrDefault();
                    if (visible != null) { return visible.Element; }
                }
                // Keep the container handle, but read its live frame for every
                // gesture. The heading snapshot only plans direction/distance.
                var frame = MobilePlatformAdapter.ReadFrame(reader);
                var bounds = new Rectangle(frame.Location, frame.Size);
                var viewport = Rectangle.Intersect(bounds, new Rectangle(Point.Empty, window));
                if (target != null && target.Snapshot.IsVisibleIn(window) && lastHeading is { } heading
                    && viewport.Contains(heading.X + heading.Width / 2, heading.Y + heading.Height / 2))
                {
                    return target.Element;
                }
                driver.PerformActions([ReaderScrollActions.ReturnToHeading(bounds, window, lastHeading)]);
            }
            catch (StaleElementReferenceException)
            {
                reader = null;
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // A straggler command during scroll churn retries the whole
                // iteration instead of ending the return budget early.
            }
        }
        throw new WebDriverTimeoutException($"The selected heading {automationId} was not found within the reader's 45-second return budget; last frame: {lastHeading}.");
    }

    public void OpenCircularMenu()
    {
        Tap("CircularMenuButton");
        WaitFor("TodayButton", element => element.Enabled);
    }

    public void AssertBottomNavigationLayout()
    {
        var window = DriverTelemetry.WindowSize(driver);
        // The accepting poll's snapshot supplies each button's frame and the
        // enabled condition — no live property read follows the waits.
        var buttons = new[] { "CircularMenuButton", "TextButton", "FullScreenButton" }
            .Select(id => WaitForStableFrame(id, element => element.Enabled))
            .ToArray();
        foreach (var (location, size) in buttons)
        {
            Assert.True(size.Width >= platform.Layout.MinimumButtonExtent);
            Assert.True(size.Height >= platform.Layout.MinimumButtonExtent);
            Assert.True(HasVisibleCenter(location, size, window), "The control's tap target must be inside the viewport.");
            Assert.InRange(location.X, 0, window.Width - size.Width);
            Assert.InRange(location.Y, 0, window.Height - size.Height);
        }
        var menuCenter = (buttons[0].Location.X + buttons[0].Size.Width / 2.0) / window.Width;
        Assert.InRange(menuCenter, 0.5 - platform.Layout.MenuCenterTolerance, 0.5 + platform.Layout.MenuCenterTolerance);
    }

    // Every element read is a WDA round-trip on iOS; hundreds of displayed/
    // text/rect/label calls ran about five minutes inside a shard's 15-minute
    // wall clock. The snapshot driver carries text, visibility and frames for
    // every match in a single lookup response, and there a labeled cell's text
    // is its accessibility description. Share that single-scan read so tests
    // never fall back to per-element property queries on the live elements.
    public IReadOnlyList<(AppiumElement Element, string Text, (System.Drawing.Point Location, System.Drawing.Size Size) Frame)>
        RenderedElements(string automationId) =>
        RenderedElements(automationId, element => element.Text);

    public (AppiumElement Element, (Point Location, Size Size) Frame)? FirstVisibleElement(
        string automationId, Func<AppiumElement, bool> condition)
    {
        var match = FindVisible(platform.AutomationId(automationId), condition).FirstOrDefault();
        return match is null ? null : (match.Element, (match.Frame.Location, match.Frame.Size));
    }

    /// <summary>
    /// Same single-scan read as <see cref="RenderedElements(string)"/>, but
    /// callers choose how the Android fallback extracts text (the snapshot
    /// path on iOS always carries the announced label).
    /// </summary>
    public IReadOnlyList<(AppiumElement Element, string Text, (System.Drawing.Point Location, System.Drawing.Size Size) Frame)>
        RenderedElements(string automationId, Func<AppiumElement, string> text) =>
        RenderedElements(platform.AutomationId(automationId), text);

    /// <inheritdoc cref="RenderedElements(string)"/>
    public IReadOnlyList<(AppiumElement Element, string Text, (System.Drawing.Point Location, System.Drawing.Size Size) Frame)>
        RenderedElements(By locator) =>
        RenderedElements(locator, element => element.Text);

    /// <inheritdoc cref="RenderedElements(string, Func{AppiumElement, string})"/>
    public IReadOnlyList<(AppiumElement Element, string Text, (System.Drawing.Point Location, System.Drawing.Size Size) Frame)>
        RenderedElements(By locator, Func<AppiumElement, string> text)
    {
        if (driver is IosSnapshotDriver snapshots)
        {
            return snapshots.FindSnapshots(locator)
                .Where(match => match.Snapshot.Displayed)
                .Select(match => (match.Element, match.Snapshot.Text.Trim(),
                    (new System.Drawing.Point(Convert.ToInt32(match.Snapshot.X),
                        Convert.ToInt32(match.Snapshot.Y)),
                     new System.Drawing.Size(Convert.ToInt32(match.Snapshot.Width),
                        Convert.ToInt32(match.Snapshot.Height)))))
                .ToArray();
        }
        return driver!.FindElements(locator)
            .Where(element => element.Displayed)
            .Select(element => (element, text(element).Trim(),
                MobilePlatformAdapter.ReadFrame(element)))
            .ToArray();
    }

    /// <summary>
    /// The announced label/description of the first visible match, captured
    /// inside the poll's snapshot — unlike <c>WaitFor(...).Text</c> or a later
    /// GetAttribute call, this costs no extra device round-trip on iOS.
    /// </summary>
    public string WaitForSpoken(string automationId) =>
        WaitForSpoken(automationId, _ => true);

    /// <inheritdoc cref="WaitForSpoken(string)"/>
    public string WaitForSpoken(string automationId, Func<string, bool> accept) =>
        WaitForSpoken(automationId, accept, TimeSpan.FromSeconds(45));

    private string WaitForSpoken(string automationId, Func<string, bool> accept, TimeSpan timeout)
    {
        var locator = platform.AutomationId(automationId);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                // FindVisible applies the same center-in-viewport rule as
                // WaitFor, and on iOS the condition element answers Text from
                // the poll's own snapshot — no second attribute request.
                var spoken = FindVisible(locator)
                    .Select(match => driver is IosSnapshotDriver
                        ? match.ConditionElement.Text.Trim()
                        : (platform.SemanticDescription(match.Element) ?? match.Element.Text).Trim())
                    .FirstOrDefault(accept);
                if (spoken != null)
                {
                    return spoken;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // Only observation timeouts retry; dead sessions escape.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No visible element matching {locator} announced an accepted text within {timeout.TotalSeconds} seconds.");
    }

    private sealed record VisibleMatch(AppiumElement Element, AppiumElement ConditionElement, Rectangle Frame);

    private IEnumerable<VisibleMatch> FindVisible(By locator, Func<AppiumElement, bool>? condition = null)
    {
        if (driver is IosSnapshotDriver snapshots)
        {
            var matches = snapshots.FindSnapshots(locator);
            if (matches.Count == 0)
            {
                return [];
            }
            // Reject wrong text/disabled state before another device request.
            // The viewport is fresh for this poll, read only when a candidate
            // can satisfy the condition, and shared by candidates in the poll.
            Size? window = null;
            return matches.Where(match => match.Snapshot.Displayed
                    && match.Snapshot.Width > 0 && match.Snapshot.Height > 0
                    && (condition == null || condition(match.ConditionElement)))
                .Where(match => match.Snapshot.IsVisibleIn(Window()))
                .Select(match => new VisibleMatch(match.Element, match.ConditionElement,
                    new Rectangle(Convert.ToInt32(match.Snapshot.X), Convert.ToInt32(match.Snapshot.Y),
                        Convert.ToInt32(match.Snapshot.Width), Convert.ToInt32(match.Snapshot.Height))));

            Size Window()
            {
                window ??= DriverTelemetry.WindowSize(driver);
                return window.Value;
            }
        }
        // Android also reads the viewport once per lookup, lazily, so an empty
        // result does not request it and every new poll observes rotations.
        Size? viewport = null;
        return Enumerate();

        IEnumerable<VisibleMatch> Enumerate()
        {
            foreach (var element in driver.FindElements(locator))
            {
                if (!element.Displayed)
                {
                    continue;
                }
                // The accepting poll's frame observation is kept on the match
                // so callers never re-read a live rect after the wait.
                var frame = new Rectangle(element.Location, element.Size);
                if (!HasVisibleCenter(frame.Location, frame.Size, Viewport())
                    || (condition != null && !condition(element)))
                {
                    continue;
                }
                yield return new VisibleMatch(element, element, frame);
            }
        }

        Size Viewport()
        {
            viewport ??= DriverTelemetry.WindowSize(driver);
            return viewport.Value;
        }
    }

    private static bool HasVisibleCenter(Point location, Size size, Size window)
    {
        var x = location.X + size.Width / 2.0;
        var y = location.Y + size.Height / 2.0;
        // Native trees can contain preloaded, offscreen carousel pages marked
        // displayed. Require the element's center to be in the actual viewport.
        return size.Width > 0 && size.Height > 0
            && x >= 0 && x < window.Width && y >= 0 && y < window.Height;
    }
}
