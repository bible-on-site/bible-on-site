using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Tests for <see cref="ReaderPlatformChrome"/> — the coordinator that owns
/// the native chrome plumbing every reader page shares (#2573): the capsule
/// <c>BackStateProvider</c> wiring and the overlay-visibility refresh are
/// cross-platform and run here; the per-platform bodies (iOS safe area +
/// history, Android Back callback, Windows accelerator) are exercised by the
/// real device builds. The page-level delegation contract lives in
/// <c>ReaderPlatformChromeContractTests</c>.
/// </summary>
public class ReaderPlatformChromeTests : IDisposable
{
    private sealed class FakeSearchSurface : IReaderSearchSurface
    {
        private EventHandler? _searchOpenChanged;

        // Explicit accessor keeps the fake to the contract's shape — the
        // coordinator subscribes through the interface.
        event EventHandler? IReaderSearchSurface.SearchOpenChanged
        {
            add => _searchOpenChanged += value;
            remove => _searchOpenChanged -= value;
        }

        public void RaiseOpenChanged() => _searchOpenChanged?.Invoke(this, EventArgs.Empty);
    }

    private sealed class FakePerushimSheet : IReaderPerushimSheetSurface
    {
        private EventHandler<bool>? _isOpenChanged;

        event EventHandler<bool>? IReaderPerushimSheetSurface.IsOpenChanged
        {
            add => _isOpenChanged += value;
            remove => _isOpenChanged -= value;
        }

#pragma warning disable S1172 // Fake satisfies the interface contract; toggle arguments unused.
        public Task ToggleAsync(double hostHeight, double maxExpandedHeight) => Task.CompletedTask;
#pragma warning restore S1172

        public void CloseImmediate()
        {
            // Fake no-op — tests drive open state through RaiseOpenChanged.
        }

        public void RaiseOpenChanged(bool isOpen) => _isOpenChanged?.Invoke(this, isOpen);
    }

    /// <summary>The rig every reader page constructs in SetupPlatformChrome.</summary>
    private sealed class Rig
    {
        public readonly ContentPage Page = new();
        public readonly Grid Root = new();
        public readonly SharedTopBar NavigationBar = new();
        public readonly Grid BottomBar = new();
        public readonly ReaderFanMenu Fan = new();
        public readonly Grid Carousel = new();
        public readonly Grid MenuOverlay = new();
        public readonly ReaderExitFullscreenButton ExitButton = new();
        public readonly FakeSearchSurface Search = new();
        public readonly Grid SelectionBar = new();
        public readonly FakePerushimSheet Sheet = new();

        public bool OwnsSurface;
        public int TryHandleCalls;

        public ReaderPlatformChrome CreateChrome(bool withSearchTriggers = true)
        {
            return new ReaderPlatformChrome(
                new ReaderPlatformChromeSurfaces
                {
                    Page = Page,
                    Root = Root,
                    NavigationBar = NavigationBar,
                    BottomBar = BottomBar,
                    FanMenu = Fan,
                    Carousel = Carousel,
                    BackSensitiveOverlays = [MenuOverlay, ExitButton],
                    SearchSurface = withSearchTriggers ? Search : null,
                    SelectionSurface = withSearchTriggers ? SelectionBar : null,
                    PerushimSheet = Sheet,
                },
                new ReaderPlatformChromeActions
                {
                    OwnsReturnSurface = () => OwnsSurface,
                    TryHandleBack = () => { TryHandleCalls++; return false; },
                });
        }
    }

    public ReaderPlatformChromeTests()
    {
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
    }

    public void Dispose()
    {
        PreferencesService.ResetForTesting();
    }

    [Fact]
    public void Constructor_InstallsCapsuleBackStateProvider()
    {
        var rig = new Rig { OwnsSurface = true };
        _ = rig.CreateChrome();

        rig.NavigationBar.BackStateProvider.Should().NotBeNull();
        rig.NavigationBar.BackStateProvider!().Should().BeTrue(
            "the capsule delegates to the page's transient-surface provider");
    }

    [Fact]
    public void OverlayBecomingVisible_RefreshesCapsuleBackState()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();
        rig.NavigationBar.BackEnabled.Should().BeFalse(
            "no transient surface at a root destination keeps Back disabled");

        rig.MenuOverlay.IsVisible = false; // settle a flip before the provider goes live
        rig.OwnsSurface = true;
        rig.MenuOverlay.IsVisible = true;

        rig.NavigationBar.BackEnabled.Should().BeTrue(
            "the overlay's IsVisible notification re-derives the capsule state");
    }

    [Fact]
    public void OverlayNonVisibilityChange_DoesNotRefreshCapsule()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();
        rig.OwnsSurface = true;

        rig.MenuOverlay.Opacity = 0.5;

        rig.NavigationBar.BackEnabled.Should().BeFalse(
            "only IsVisible changes feed the back refresh — paint-only changes do not");
    }

    [Fact]
    public void EachBackSensitiveOverlay_RefreshesIndependently()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();
        rig.OwnsSurface = true;

        rig.ExitButton.IsVisible = true; // starts hidden — flipping it is a real change

        rig.NavigationBar.BackEnabled.Should().BeTrue(
            "the exit-fullscreen overlay drives the same refresh as the menu");
    }

    [Fact]
    public void PerushimSheetOpenChange_RefreshesCapsuleBackState()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();
        rig.NavigationBar.BackEnabled.Should().BeFalse(
            "no transient surface at a root destination keeps Back disabled");

        rig.OwnsSurface = true;
        rig.Sheet.RaiseOpenChanged(true);

        rig.NavigationBar.BackEnabled.Should().BeTrue(
            "the sheet's own IsOpenChanged re-derives the capsule state — " +
            "it reports no IsVisible flip the overlay subscription could ride (#2766)");
    }

    [Fact]
    public void SearchAndSelectionTriggers_AreWiredAndHarmless()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();

        // The native-back channel they feed is Android-only; raising them
        // must stay a no-op everywhere else.
        FluentActions.Invoking(() =>
        {
            rig.Search.RaiseOpenChanged();
            rig.SelectionBar.IsVisible = false; // real flips fire PropertyChanged
            rig.SelectionBar.IsVisible = true;
        }).Should().NotThrow();
    }

    [Fact]
    public void LifecycleCalls_AreSafeOnEveryPlatform()
    {
        var rig = new Rig();
        var chrome = rig.CreateChrome();

        FluentActions.Invoking(() =>
        {
            chrome.Appearing();
            chrome.ReaderSurfaceRealized();
            chrome.ScheduleHistoryRefresh();
            chrome.RefreshNativeBack();
            chrome.Disappearing();
        }).Should().NotThrow(
            "the per-platform bodies compile to no-ops outside their target");
    }

    [Fact]
    public void Constructor_AcceptsReaderWithoutSearchSurfaces()
    {
        var rig = new Rig();
        FluentActions.Invoking(() => rig.CreateChrome(withSearchTriggers: false))
            .Should().NotThrow(
                "masora-style readers carry no search/selection triggers");
    }
}
