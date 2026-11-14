using BibleOnSite.Controls;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// #2724 — the search-filter rows need a 44×44 hit target whose visible square
/// centers vertically; on Android the stock CheckBox gravity pinned the square
/// to the top of the control.
/// </summary>
public class CenteredCheckBoxTests
{
    [Fact]
    public void Defaults_MatchTheRowHitTarget()
    {
        var box = new CenteredCheckBox();

        box.WidthRequest.Should().Be(44);
        box.HeightRequest.Should().Be(44);
    }

    [Fact]
    public void IsChecked_BehavesLikeANormalCheckBox()
    {
        var box = new CenteredCheckBox();
        var raised = 0;
        box.CheckedChanged += (_, _) => raised++;

        box.IsChecked = true;

        box.IsChecked.Should().BeTrue();
        raised.Should().Be(1);

        box.IsChecked = false;
        box.IsChecked.Should().BeFalse();
        raised.Should().Be(2);
    }

    [Fact]
    public void CenterNativeSquare_NonCheckBoxPlatformView_DoesNotThrow()
    {
        // On non-Android builds the body compiles to a no-op; the call must
        // still tolerate an arbitrary platform view without throwing.
        var act = () => CenteredCheckBox.CenterNativeSquare(new object());

        act.Should().NotThrow();
    }
}
