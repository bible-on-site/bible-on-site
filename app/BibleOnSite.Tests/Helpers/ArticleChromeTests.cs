using System.Reflection;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Contract tests for <see cref="ArticleChrome"/> — the coordinator that owns
/// the article view's fullscreen surface shared by the article detail and
/// Tanahpedia entry pages (#2786): the actions pill raises the transition
/// request, the top bar collapses, the shared draggable exit control
/// appears, and Back consumes the surface before any navigation. The
/// actions surface is faked through the same interface the XAML control
/// implements; the exit button runs real. The page-level wiring contract
/// lives in ArticleChromeContractTests.
/// </summary>
public class ArticleChromeTests
{
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
                },
            };
        }

        public void Dispose() => Application.Current = _previous;
    }

    private sealed class FakeActions : IArticleActionsSurface
    {
        private EventHandler? _fullScreenRequested;

        // Explicit accessor keeps the fake to the contract's shape — Codacy's
        // cross-file view cannot see the coordinator subscribing through the
        // interface and flags a plainly-declared event as unused.
        event EventHandler? IArticleActionsSurface.FullScreenRequested
        {
            add => _fullScreenRequested += value;
            remove => _fullScreenRequested -= value;
        }

        public void RaiseFullScreen() => _fullScreenRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>The rig every article page constructs in its SetupArticleChrome.</summary>
    private sealed class Rig
    {
        public readonly FakeActions Actions = new();
        public readonly ReaderExitFullscreenButton ExitButton = new();
        public readonly Grid Toolbar = new();
        public readonly List<bool> FullscreenChanges = new();

        public Rig()
        {
            Toolbar.IsVisible = true;
        }

        public ArticleChrome CreateChrome() =>
            new(new ArticleChromeSurfaces
            {
                Toolbar = Toolbar,
                Actions = Actions,
                ExitFullscreenButton = ExitButton,
            })
            {
                FullscreenStateChanged = isFullScreen => FullscreenChanges.Add(isFullScreen),
            };
    }

    private static void SendTapped(VisualElement owner, TapGestureRecognizer gesture) =>
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", BindingFlags.Instance | BindingFlags.NonPublic)!
            .Invoke(gesture, [owner, null]);

    private static void TapExit(ReaderExitFullscreenButton button) =>
        SendTapped(button, button.GestureRecognizers.OfType<TapGestureRecognizer>().Single());

    [Fact]
    public void FullScreenRequest_HidesBar_ShowsExit_AndNotifies()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.ExitButton.IsVisible.Should().BeFalse("the exit button starts hidden");

        rig.Actions.RaiseFullScreen();

        rig.Toolbar.IsVisible.Should().BeFalse("fullscreen maximizes the reading surface");
        rig.ExitButton.IsVisible.Should().BeTrue("the shared floating exit appears");
        rig.ExitButton.TranslationX.Should().Be(0, "entry resets the drag position");
        rig.ExitButton.TranslationY.Should().Be(0);
        rig.FullscreenChanges.Should().Equal(true);
        chrome.IsFullScreen.Should().BeTrue();
    }

    [Fact]
    public void ExitFullScreen_RestoresBar_AndNotifies()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.Actions.RaiseFullScreen();
        rig.FullscreenChanges.Should().Equal(true);

        TapExit(rig.ExitButton);

        rig.ExitButton.IsVisible.Should().BeFalse();
        rig.Toolbar.IsVisible.Should().BeTrue("the same bar returns over the article");
        rig.FullscreenChanges.Should().Equal(true, false);
        chrome.IsFullScreen.Should().BeFalse();
    }

    [Fact]
    public void HandleBack_WhenFullScreen_ExitsAndConsumes()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();
        rig.Actions.RaiseFullScreen();

        var consumed = chrome.HandleBack();

        consumed.Should().BeTrue("Back releases the transient surface before navigation");
        chrome.IsFullScreen.Should().BeFalse();
        rig.Toolbar.IsVisible.Should().BeTrue();
    }

    [Fact]
    public void HandleBack_WhenNotFullScreen_Declines()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();

        chrome.HandleBack().Should().BeFalse(
            "no surface is up — the shared pipeline owns the press");
        rig.Toolbar.IsVisible.Should().BeTrue();
    }

    [Fact]
    public void EnterFullScreen_Twice_IsIdempotent()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        rig.CreateChrome();

        rig.Actions.RaiseFullScreen();
        rig.Actions.RaiseFullScreen();

        rig.FullscreenChanges.Should().Equal([true],
            "a repeated enter cannot stack a second notification or re-hide the bar");
    }

    [Fact]
    public void ExitFullScreen_WhenNotFullScreen_IsNoOp()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();

        chrome.ExitFullScreen();

        rig.Toolbar.IsVisible.Should().BeTrue();
        rig.ExitButton.IsVisible.Should().BeFalse();
        rig.FullscreenChanges.Should().BeEmpty();
    }

    [Fact]
    public void FullScreen_Toggle_RepeatsCleanly()
    {
        using var _ = new AppResources();
        var rig = new Rig();
        var chrome = rig.CreateChrome();

        rig.Actions.RaiseFullScreen();
        chrome.ExitFullScreen();
        rig.Actions.RaiseFullScreen();

        chrome.IsFullScreen.Should().BeTrue("repeated toggles stay in the same state machine");
        rig.FullscreenChanges.Should().Equal(true, false, true);
    }
}
