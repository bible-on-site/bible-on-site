using System.Reflection;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using Microsoft.Maui;
using Microsoft.Maui.Animations;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Microsoft.Maui.Layouts;
using CoreAnimation = Microsoft.Maui.Animations.Animation;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Contract tests for <see cref="ReaderChrome"/> — the coordinator that owns
/// the chrome-surface state machine every reader page shares (#2573): the
/// perushim sheet toggle + chevron sync, articles/text view swap, fullscreen
/// transitions, fan prev/next refresh, and picker-confirmation cleanup
/// (#2476). The bottom bar, perushim sheet and articles view are faked
/// through the same interfaces the XAML controls implement; the fan, its
/// satellites and the exit button run real (animations ticked via a mocked
/// context, like <see cref="BibleOnSite.Tests.Controls.ReaderFanMenuTests"/>).
/// The page-level wiring contract lives in ReaderChromeContractTests.
/// </summary>
public class ReaderChromeTests
{
    /// <summary>
    /// Attaches a mocked MAUI context to a view tree so <c>FadeToAsync</c>
    /// resolves an animation manager; <see cref="TickAll"/> lands every queued
    /// animation at its end value (same harness as ReaderFanMenuTests).
    /// </summary>
    private sealed class TestContext
    {
        private readonly List<CoreAnimation> _pending = new();
        private readonly Mock<IMauiContext> _context = new();

        public TestContext()
        {
            var ticker = new Mock<ITicker>();
            ticker.SetupGet(t => t.SystemEnabled).Returns(true);
            var manager = new Mock<IAnimationManager>();
            manager.SetupGet(m => m.Ticker).Returns(ticker.Object);
            manager.Setup(m => m.Add(It.IsAny<CoreAnimation>())).Callback<CoreAnimation>(a => _pending.Add(a));
            manager.Setup(m => m.Remove(It.IsAny<CoreAnimation>())).Callback<CoreAnimation>(a => _pending.Remove(a));
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(dispatcher.Object);
            services.Setup(s => s.GetService(typeof(IAnimationManager))).Returns(manager.Object);
            _context.SetupGet(c => c.Services).Returns(services.Object);
        }

        public void Attach(View view)
        {
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(_context.Object);
            view.Handler = handler.Object;
            if (view is Layout layout)
            {
                foreach (var child in layout.Children.OfType<View>())
                {
                    Attach(child);
                }
            }
        }

        /// <summary>Completes every pending animation at its final value.</summary>
        public void TickAll()
        {
            foreach (var animation in _pending.ToArray())
            {
                animation.Tick(10_000);
            }
            _pending.RemoveAll(a => a.HasFinished);
        }
    }

    private sealed class AppResources : IDisposable
    {
        private readonly Application? _previous;

        public AppResources()
        {
            _previous = Application.Current;
            Application.Current = new Application
            {
                Resources = new ResourceDictionary
                {
                    ["Primary"] = Colors.Blue,
                    ["PrimaryDark"] = Colors.DarkBlue
                }
            };
        }

        public void Dispose() => Application.Current = _previous;
    }

    private sealed class FakeBottomBar : IReaderBottomBarSurface
    {
        private EventHandler? _perushimToggleRequested;
        private EventHandler? _textModeRequested;
        private EventHandler? _articlesRequested;
        private EventHandler? _fullScreenRequested;

        // Explicit accessors keep the fake to the contract's shape — Codacy's
        // cross-file view cannot see the coordinator subscribing through the
        // interface and flags plainly-declared events as unused.
        event EventHandler? IReaderBottomBarSurface.PerushimToggleRequested
        {
            add => _perushimToggleRequested += value;
            remove => _perushimToggleRequested -= value;
        }

        event EventHandler? IReaderBottomBarSurface.TextModeRequested
        {
            add => _textModeRequested += value;
            remove => _textModeRequested -= value;
        }

        event EventHandler? IReaderBottomBarSurface.ArticlesRequested
        {
            add => _articlesRequested += value;
            remove => _articlesRequested -= value;
        }

        event EventHandler? IReaderBottomBarSurface.FullScreenRequested
        {
            add => _fullScreenRequested += value;
            remove => _fullScreenRequested -= value;
        }

        private bool _isPerushimOpen;
        private bool _isArticlesActive;
        private bool _isVisible = true;

        public bool IsPerushimOpen { get => _isPerushimOpen; set => _isPerushimOpen = value; }
        public bool IsArticlesActive { get => _isArticlesActive; set => _isArticlesActive = value; }
        public bool IsVisible { get => _isVisible; set => _isVisible = value; }

        public void RaisePerushimToggle() => _perushimToggleRequested?.Invoke(this, EventArgs.Empty);
        public void RaiseTextMode() => _textModeRequested?.Invoke(this, EventArgs.Empty);
        public void RaiseArticles() => _articlesRequested?.Invoke(this, EventArgs.Empty);
        public void RaiseFullScreen() => _fullScreenRequested?.Invoke(this, EventArgs.Empty);
    }

    private sealed class FakePerushimSheet : IReaderPerushimSheetSurface
    {
        private EventHandler<bool>? _isOpenChanged;

        event EventHandler<bool>? IReaderPerushimSheetSurface.IsOpenChanged
        {
            add => _isOpenChanged += value;
            remove => _isOpenChanged -= value;
        }

        public List<(double Host, double Max)> Toggles { get; } = new();
        public int CloseImmediateCount { get; private set; }
        public bool IsOpen { get; private set; }

        public Task ToggleAsync(double hostHeight, double maxExpandedHeight)
        {
            Toggles.Add((hostHeight, maxExpandedHeight));
            RaiseOpenChanged(!IsOpen);
            return Task.CompletedTask;
        }

        public void CloseImmediate()
        {
            CloseImmediateCount++;
            if (IsOpen)
            {
                RaiseOpenChanged(false);
            }
        }

        /// <summary>Flips the recorded state and publishes it like the real sheet.</summary>
        public void RaiseOpenChanged(bool isOpen)
        {
            IsOpen = isOpen;
            _isOpenChanged?.Invoke(this, isOpen);
        }
    }

    private sealed class FakeArticlesView : IReaderArticlesSurface
    {
        private EventHandler<Article>? _articleSelected;
        private bool _isVisible;

        event EventHandler<Article>? IReaderArticlesSurface.ArticleSelected
        {
            add => _articleSelected += value;
            remove => _articleSelected -= value;
        }

        public bool IsVisible { get => _isVisible; set => _isVisible = value; }

        public void RaiseSelected(Article article) => _articleSelected?.Invoke(this, article);
    }

    /// <summary>
    /// The rig every reader page constructs in its SetupReaderChrome: the same
    /// surface wiring, with fake bar/sheet/articles and real fan controls.
    /// </summary>
    private sealed class Rig
    {
        public readonly FakeBottomBar BottomBar = new();
        public readonly FakePerushimSheet Sheet = new();
        public readonly FakeArticlesView Articles = new();
        public readonly ReaderFanMenu Fan = new();
        public readonly ReaderFanMenuSatellite Prev = new();
        public readonly ReaderFanMenuSatellite Next = new();
        public readonly ReaderExitFullscreenButton ExitButton = new();
        public readonly Grid Content = new();
        public readonly Grid Toolbar = new();
        public readonly Grid Host = new();
        public readonly Grid ContentArea = new();
        public readonly TestContext Context = new();

        public readonly object Unit = new();
        public int CurrentId = 3;
        public bool CanPrev = true;
        public bool CanNext = true;
        public Func<int, bool> IsSelectable = id => id > 0;

        public readonly List<int> Navigations = new();
        public readonly List<int?> Selections = new();
        public readonly List<bool> FullscreenChanges = new();
        public int ReloadCount;

        public Rig()
        {
            Fan.Satellites.Add(Prev);
            Fan.Satellites.Add(Next);
            Context.Attach(Fan);
            // The chevron geometry reads the laid-out heights the page measured.
            Host.Arrange(new Rect(0, 0, 400, 800));
            ContentArea.Arrange(new Rect(0, 0, 400, 700));
            Toolbar.Arrange(new Rect(0, 0, 400, 56));
        }

        public ReaderChrome CreateChrome()
        {
            return new ReaderChrome(
                new ReaderChromeSurfaces
                {
                    BottomBar = BottomBar,
                    PerushimSheet = Sheet,
                    FanMenu = Fan,
                    PreviousSatellite = Prev,
                    NextSatellite = Next,
                    ExitFullscreenButton = ExitButton,
                    ArticlesView = Articles,
                    ReaderContent = Content,
                    Toolbar = Toolbar,
                    Host = Host,
                    ContentArea = ContentArea,
                },
                new ReaderChromeActions
                {
                    ReloadArticlesAsync = () => { ReloadCount++; return Task.CompletedTask; },
                    CurrentUnit = () => Unit,
                    SelectArticle = id => Selections.Add(id),
                    CanGoPrevious = () => CanPrev,
                    CanGoNext = () => CanNext,
                    IsSelectableUnit = id => IsSelectable(id),
                    CurrentUnitId = () => CurrentId,
                    NavigateToUnitAsync = id => { Navigations.Add(id); return Task.CompletedTask; },
                    FullscreenStateChanged = isFullScreen => FullscreenChanges.Add(isFullScreen),
                });
        }

        public async Task OpenFanAsync()
        {
            var openTask = Fan.OpenAsync();
            Context.TickAll();
            await openTask;
        }
    }

    /// <summary>Restores the coordinator's static test seams after each test.</summary>
    private sealed class Seams : IDisposable
    {
        private readonly Func<int, Task> _openArticle = ReaderChrome.OpenArticle;
        private readonly Func<VisualElement, object?, bool> _scrollToStart = ReaderChrome.ScrollToStart;

        public void Dispose()
        {
            ReaderChrome.OpenArticle = _openArticle;
            ReaderChrome.ScrollToStart = _scrollToStart;
        }
    }

    private static void SendTapped(VisualElement owner, TapGestureRecognizer gesture) =>
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(gesture, [owner, null]);

    private static void TapExit(ReaderExitFullscreenButton button) =>
        SendTapped(button, button.GestureRecognizers.OfType<TapGestureRecognizer>().Single());

    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public async Task FanOpening_RefreshesSatelliteEnabledState_FromActions(bool canPrev, bool canNext)
    {
        using var resources = new AppResources();
        var rig = new Rig { CanPrev = canPrev, CanNext = canNext };
        _ = rig.CreateChrome();

        await rig.OpenFanAsync();

        rig.Prev.IsEnabled.Should().Be(canPrev);
        rig.Next.IsEnabled.Should().Be(canNext);
        rig.Prev.Opacity.Should().BeApproximately(canPrev ? 1.0 : 0.4, 0.001);
        rig.Next.Opacity.Should().BeApproximately(canNext ? 1.0 : 0.4, 0.001);
    }

    [Fact]
    public void RefreshPrevNext_ClosedFan_IsNoOp()
    {
        using var _ = new AppResources();
        var rig = new Rig { CanPrev = false };
        var chrome = rig.CreateChrome();

        chrome.RefreshPrevNext();

        rig.Prev.IsEnabled.Should().BeTrue("a closed fan keeps its satellites untouched until Opening re-reads them");
    }

    [Fact]
    public async Task RefreshPrevNext_OpenFan_UpdatesSatellitesAfterUnitChange()
    {
        using var _ = new AppResources();
        var rig = new Rig { CanPrev = false, CanNext = true };
        var chrome = rig.CreateChrome();
        await rig.OpenFanAsync();
        rig.Prev.IsEnabled.Should().BeFalse();

        rig.CanPrev = true;
        rig.CanNext = false;
        chrome.RefreshPrevNext();

        rig.Prev.IsEnabled.Should().BeTrue();
        rig.Next.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public void PerushimToggle_TogglesSheet_WithHeightCappedBelowToolbar()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();

        rig.BottomBar.RaisePerushimToggle();

        rig.Sheet.Toggles.Should().ContainSingle()
            .Which.Should().Be((800d, 700d + 56d - 8d),
                "host height plus content + toolbar − 8 keeps the sheet under the status bar");
        rig.BottomBar.IsPerushimOpen.Should().BeTrue("the sheet's IsOpenChanged mirrors onto the chevron");
    }

    [Fact]
    public void PerushimToggle_WhenToolbarHidden_CapsAtContentOnly()
    {
        var rig = new Rig();
        rig.Toolbar.IsVisible = false;
        _ = rig.CreateChrome();

        rig.BottomBar.RaisePerushimToggle();

        rig.Sheet.Toggles.Should().ContainSingle()
            .Which.Should().Be((800d, 700d - 8d));
    }

    [Fact]
    public void SheetOpenChanged_FromPan_MirrorsChevronState()
    {
        var rig = new Rig();
        _ = rig.CreateChrome();

        rig.Sheet.RaiseOpenChanged(true);
        rig.BottomBar.IsPerushimOpen.Should().BeTrue();

        rig.Sheet.RaiseOpenChanged(false);
        rig.BottomBar.IsPerushimOpen.Should().BeFalse();
    }

    [Fact]
    public void ArticlesButton_ShowsArticles_ClosesSheet_AndMarksBarActive()
    {
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.Sheet.RaiseOpenChanged(true);

        rig.BottomBar.RaiseArticles();

        rig.Sheet.CloseImmediateCount.Should().Be(1);
        rig.Sheet.IsOpen.Should().BeFalse("entering articles collapses the sheet without animation");
        chrome.IsShowingArticles.Should().BeTrue();
        rig.ReloadCount.Should().Be(1);
        rig.Content.IsVisible.Should().BeFalse();
        rig.Articles.IsVisible.Should().BeTrue();
        rig.BottomBar.IsArticlesActive.Should().BeTrue();
    }

    [Fact]
    public void ArticlesButton_SecondTap_IsNoOp()
    {
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.BottomBar.RaiseArticles();
        rig.Articles.IsVisible.Should().BeTrue();

        rig.BottomBar.RaiseArticles();

        rig.ReloadCount.Should().Be(1, "an already-open articles view ignores repeat taps");
        chrome.IsShowingArticles.Should().BeTrue();
    }

    [Fact]
    public void ArticlesButton_WhenReloadThrows_DoesNotPropagate()
    {
        var rig = new Rig();
        var chrome = new ReaderChrome(
            new ReaderChromeSurfaces
            {
                BottomBar = rig.BottomBar,
                PerushimSheet = rig.Sheet,
                FanMenu = rig.Fan,
                PreviousSatellite = rig.Prev,
                NextSatellite = rig.Next,
                ExitFullscreenButton = rig.ExitButton,
                ArticlesView = rig.Articles,
                ReaderContent = rig.Content,
                Toolbar = rig.Toolbar,
                Host = rig.Host,
                ContentArea = rig.ContentArea,
            },
            new ReaderChromeActions
            {
                ReloadArticlesAsync = () => throw new InvalidOperationException("service down"),
                CurrentUnit = () => rig.Unit,
                SelectArticle = _ => { },
                CanGoPrevious = () => true,
                CanGoNext = () => true,
                IsSelectableUnit = _ => true,
                CurrentUnitId = () => 1,
                NavigateToUnitAsync = _ => Task.CompletedTask,
            });

        FluentActions.Invoking(() => rig.BottomBar.RaiseArticles()).Should().NotThrow(
            "a failing articles load degrades to a log line, never a reader crash");
        chrome.IsShowingArticles.Should().BeTrue();
    }

    [Fact]
    public void TextButton_FromArticles_ReturnsToReadingView()
    {
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.BottomBar.RaiseArticles();
        rig.Articles.IsVisible.Should().BeTrue();

        rig.BottomBar.RaiseTextMode();

        chrome.IsShowingArticles.Should().BeFalse();
        rig.Selections.Should().ContainSingle().Which.Should().BeNull(
            "leaving articles clears the selected-article highlight");
        rig.Articles.IsVisible.Should().BeFalse();
        rig.Content.IsVisible.Should().BeTrue();
        rig.BottomBar.IsArticlesActive.Should().BeFalse();
    }

    [Fact]
    public void TextButton_InReadingView_ScrollsCurrentUnitToStart()
    {
        using var seams = new Seams();
        var rig = new Rig();
        _ = rig.CreateChrome();
        VisualElement? scrolledRoot = null;
        object? scrolledUnit = null;
        ReaderChrome.ScrollToStart = (root, unit) => { scrolledRoot = root; scrolledUnit = unit; return true; };

        rig.BottomBar.RaiseTextMode();

        scrolledRoot.Should().BeSameAs(rig.Content);
        scrolledUnit.Should().BeSameAs(rig.Unit);
    }

    [Fact]
    public void FullScreen_HidesBars_ShowsExit_AndNotifies()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.ExitButton.IsVisible.Should().BeFalse("the exit button starts hidden");

        rig.BottomBar.RaiseFullScreen();

        rig.Toolbar.IsVisible.Should().BeFalse();
        rig.BottomBar.IsVisible.Should().BeFalse();
        rig.Fan.IsVisible.Should().BeFalse();
        rig.ExitButton.IsVisible.Should().BeTrue();
        rig.ExitButton.TranslationX.Should().Be(0, "entry resets the drag position");
        rig.ExitButton.TranslationY.Should().Be(0);
        rig.FullscreenChanges.Should().Equal(true);
        chrome.IsFullScreen.Should().BeTrue();
    }

    [Fact]
    public async Task FullScreen_SnapsOpenFanClosedWithoutScrim()
    {
        using var resources = new AppResources();
        var rig = new Rig();
        _ = rig.CreateChrome();
        await rig.OpenFanAsync();
        rig.Fan.IsOpen.Should().BeTrue();

        rig.BottomBar.RaiseFullScreen();

        rig.Fan.IsOpen.Should().BeFalse("fullscreen entry cannot leave a dimming scrim over the reader");
        rig.Fan.Children.OfType<Grid>().Single(g => g.AutomationId == "CircularMenuScrim")
            .IsVisible.Should().BeFalse();
    }

    [Fact]
    public void ExitFullscreen_RestoresBars_AndNotifies()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.BottomBar.RaiseFullScreen();
        rig.FullscreenChanges.Should().Equal(true);

        TapExit(rig.ExitButton);

        rig.ExitButton.IsVisible.Should().BeFalse();
        rig.Toolbar.IsVisible.Should().BeTrue();
        rig.BottomBar.IsVisible.Should().BeTrue();
        rig.Fan.IsVisible.Should().BeTrue();
        rig.FullscreenChanges.Should().Equal(true, false);
        chrome.IsFullScreen.Should().BeFalse();
    }

    [Theory]
    // Perek ids validate 1-929; parasha and masora unit ids validate > 0 — the
    // division adapters plug their own rule into the same completion routine.
    [MemberData(nameof(DivisionPickers))]
    public async Task PickerSelection_ClosesFan_ThenNavigatesOnlyValidDifferentIds(
        string division, Func<int, bool> isSelectable, int[] invalidIds, int[] validIds)
    {
        using var _ = new AppResources();
        var rig = new Rig { IsSelectable = isSelectable, CurrentId = validIds[0] };
        var chrome = rig.CreateChrome();
        await rig.OpenFanAsync();

        // CompletePickerSelectionAsync awaits the fan's close animations —
        // drive them on the mocked ticker before awaiting the task.
        foreach (var invalidId in invalidIds)
        {
            var pick = chrome.CompletePickerSelectionAsync(invalidId);
            rig.Context.TickAll();
            await pick;
        }
        rig.Navigations.Should().BeEmpty($"{division}: out-of-range picks never navigate");
        rig.Fan.IsOpen.Should().BeFalse("but the fan always closes after a confirmed pick");

        var different = validIds.First(id => id != rig.CurrentId);
        await rig.OpenFanAsync();
        var navigate = chrome.CompletePickerSelectionAsync(different);
        rig.Context.TickAll();
        await navigate;
        rig.Navigations.Should().Equal(different);

        rig.Navigations.Clear();
        await chrome.CompletePickerSelectionAsync(rig.CurrentId);
        rig.Navigations.Should().BeEmpty("re-picking the current unit is a no-op");
    }

    public static IEnumerable<object[]> DivisionPickers => new List<object[]>
    {
        // name, IsSelectableUnit adapter, invalid picks, valid picks
        new object[] { "perek", (Func<int, bool>)(id => id is >= 1 and <= 929), new[] { 0, 930, -1 }, new[] { 1, 929, 450 } },
        new object[] { "parasha", (Func<int, bool>)(id => id > 0), new[] { 0, -5 }, new[] { 7, 42, 10_000 } },
        new object[] { "masora", (Func<int, bool>)(id => id > 0), new[] { 0, -5 }, new[] { 7, 42, 10_000 } },
    };

    [Fact]
    public async Task PickerSelection_WithoutOpenFan_StillNavigates()
    {
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.Fan.IsOpen.Should().BeFalse();

        await chrome.CompletePickerSelectionAsync(9);

        rig.Navigations.Should().Equal(new[] { 9 }, "the picker can be raised from the title too — closing is a guarded no-op");
    }

    [Fact]
    public void ArticleTap_MarksSelection_AndOpensDetail()
    {
        using var seams = new Seams();
        var rig = new Rig();
        _ = rig.CreateChrome();
        var navigated = -1;
        ReaderChrome.OpenArticle = id => { navigated = id; return Task.CompletedTask; };
        var article = new Article { Id = 77, Abstract = "x" };

        rig.Articles.RaiseSelected(article);

        rig.Selections.Should().Equal(77);
        navigated.Should().Be(77);
    }

    [Fact]
    public void ArticleTap_NavigationFailure_DoesNotPropagate()
    {
        using var seams = new Seams();
        var rig = new Rig();
        _ = rig.CreateChrome();
        ReaderChrome.OpenArticle = _ => throw new InvalidOperationException("no shell");
        var article = new Article { Id = 5, Abstract = "x" };

        FluentActions.Invoking(() => rig.Articles.RaiseSelected(article)).Should().NotThrow();
        rig.Selections.Should().Equal(new int?[] { 5 }, "the highlight still lands even when navigation fails");
    }
}
