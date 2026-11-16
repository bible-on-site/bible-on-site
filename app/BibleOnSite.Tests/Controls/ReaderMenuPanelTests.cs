using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Articles-mode capability contract for <see cref="ReaderMenuPanel"/> (#3401):
/// the ⋮ options menu shows only הסתר שם השם while the articles view is the
/// active content. The XAML rows bind their visibility to
/// <see cref="ReaderMenuPanel.IsArticlesMode"/>; these tests pin the surface
/// the shared chrome drives (<see cref="IReaderMenuSurface"/>) and the
/// stale-callback guard — a hidden scripture row must never flip its saved
/// preference even if its activation somehow still fires. The row-hiding
/// binding itself is device-rendered (FlaUI) plus the XAML contract checks.
/// </summary>
public class ReaderMenuPanelTests
{
    [Fact]
    public void IsArticlesMode_DefaultsToScriptureMenu()
    {
        IReaderMenuSurface menu = new ReaderMenuPanel();

        menu.IsArticlesMode.Should().BeFalse(
            "a fresh menu serves scripture content until the chrome says otherwise");
    }

    [Fact]
    public void ScriptureActivation_InScriptureMode_RaisesToggledAndCloses()
    {
        var menu = new ReaderMenuPanel();
        var shnayim = 0;
        var tikkun = 0;
        var masking = 0;
        menu.ShnayimMikraToggled += (_, _) => shnayim++;
        menu.TikkunKorimToggled += (_, _) => tikkun++;
        menu.DivineNameMaskingToggled += (_, _) => masking++;

        menu.IsVisible = true;
        menu.OnShnayimMikraTapped(menu, new TappedEventArgs(null));
        menu.IsOpen.Should().BeFalse("a row tap dismisses the panel");
        menu.IsVisible = true;
        menu.OnTikkunKorimTapped(menu, new TappedEventArgs(null));
        menu.IsOpen.Should().BeFalse();
        menu.IsVisible = true;
        menu.OnDivineNameMaskingTapped(menu, new TappedEventArgs(null));

        shnayim.Should().Be(1);
        tikkun.Should().Be(1);
        masking.Should().Be(1);
        menu.IsOpen.Should().BeFalse("every row tap dismisses the panel");
    }

    [Fact]
    public void ScriptureActivation_InArticlesMode_NeverRaisesToggled()
    {
        var menu = new ReaderMenuPanel { IsArticlesMode = true };
        var shnayim = 0;
        var tikkun = 0;
        var masking = 0;
        menu.ShnayimMikraToggled += (_, _) => shnayim++;
        menu.TikkunKorimToggled += (_, _) => tikkun++;
        menu.DivineNameMaskingToggled += (_, _) => masking++;

        // A hidden row cannot be tapped, but a stale/queued activation must
        // still not flip the saved שניים מקרא / תיקון קוראים modes (#3401).
        menu.OnShnayimMikraTapped(menu, new TappedEventArgs(null));
        menu.OnTikkunKorimTapped(menu, new TappedEventArgs(null));
        menu.OnDivineNameMaskingTapped(menu, new TappedEventArgs(null));

        shnayim.Should().Be(0, "the hidden scripture action is inert in articles mode");
        tikkun.Should().Be(0, "the hidden scripture action is inert in articles mode");
        masking.Should().Be(1, "הסתר שם השם stays live — it is the one article-applicable action");
    }

    [Fact]
    public void ScriptureActivation_WhenModeRestored_RaisesToggledAgain()
    {
        var menu = new ReaderMenuPanel();
        var toggles = 0;
        menu.ShnayimMikraToggled += (_, _) => toggles++;
        menu.IsArticlesMode = true;

        menu.OnShnayimMikraTapped(menu, new TappedEventArgs(null));
        toggles.Should().Be(0);

        // Returning to the text view restores the full scripture menu — the
        // saved mode keeps its value and its row activates again.
        menu.IsArticlesMode = false;

        menu.OnShnayimMikraTapped(menu, new TappedEventArgs(null));
        toggles.Should().Be(1);
    }
}
