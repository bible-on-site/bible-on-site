using BibleOnSite.Controls;

namespace BibleOnSite.Tests.Controls;

public class TriStateCheckBoxTests
{
    [Theory]
    [InlineData(0, 6, TriCheckState.Unchecked)]
    [InlineData(3, 6, TriCheckState.Indeterminate)]
    [InlineData(6, 6, TriCheckState.Checked)]
    [InlineData(0, 0, TriCheckState.Unchecked)]
    [InlineData(7, 6, TriCheckState.Checked)]
    public void DeriveState_MapsSelectionCounts(int selected, int total, TriCheckState expected) =>
        TriStateCheckBox.DeriveState(selected, total).Should().Be(expected);

    [Fact]
    public void Toggle_PartialBecomesChecked_ThenUnchecked()
    {
        var box = new TriStateCheckBox { State = TriCheckState.Indeterminate };

        box.Toggle();
        box.State.Should().Be(TriCheckState.Checked, "a partial set selects everything on tap");

        box.Toggle();
        box.State.Should().Be(TriCheckState.Unchecked, "a full set clears on tap");
    }

    [Fact]
    public void Toggle_RaisesToggledWithNewState()
    {
        var box = new TriStateCheckBox();
        var raised = 0;
        box.Toggled = () => raised++;

        box.Toggle();

        raised.Should().Be(1);
        box.State.Should().Be(TriCheckState.Checked);
    }

    [Fact]
    public void Toggle_DisabledBox_DoesNothing()
    {
        var box = new TriStateCheckBox { IsEnabled = false };

        box.Toggle();

        box.State.Should().Be(TriCheckState.Unchecked);
    }
}
