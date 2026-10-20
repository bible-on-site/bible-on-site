using BibleOnSite.Controls;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

public class NumberPickerTests
{
    [Fact]
    public void Value_ClampsToRange()
    {
        var picker = new NumberPicker { Minimum = 1, Maximum = 100 };
        picker.Value = 250;
        picker.Value.Should().Be(100);
        picker.Value = -3;
        picker.Value.Should().Be(1);
    }

    [Fact]
    public void Value_SnapsToIncrementGrid()
    {
        var picker = new NumberPicker { Minimum = 5, Maximum = 50, Increment = 5 };
        picker.Value = 12;
        picker.Value.Should().Be(10);
        picker.Value = 13;
        picker.Value.Should().Be(15);
    }

    [Fact]
    public void StepButtons_AdjustWithinBounds()
    {
        var picker = new NumberPicker { Minimum = 1, Maximum = 3 };
        picker.Value = 1;
        picker.DecrementButton.IsEnabled.Should().BeFalse();
        picker.IncrementButton.IsEnabled.Should().BeTrue();

        picker.IncrementButton.SendClicked();
        picker.Value.Should().Be(2);
        picker.IncrementButton.SendClicked();
        picker.Value.Should().Be(3);
        picker.IncrementButton.IsEnabled.Should().BeFalse();

        picker.DecrementButton.SendClicked();
        picker.Value.Should().Be(2);
        picker.DecrementButton.IsEnabled.Should().BeTrue();
    }

    [Fact]
    public void ValueChanged_FiresOnStep()
    {
        var picker = new NumberPicker { Minimum = 0, Maximum = 10 };
        var fired = 0;
        picker.ValueChanged += (_, _) => fired++;
        picker.IncrementButton.SendClicked();
        fired.Should().Be(1);
    }

    [Fact]
    public void CommitEntry_InvalidText_RevertsToValue()
    {
        var picker = new NumberPicker { Minimum = 1, Maximum = 100 };
        picker.Value = 5;
        picker.ValueEntry.Text = "abc";
        picker.ValueEntry.SendCompleted();
        picker.Value.Should().Be(5);
        picker.ValueEntry.Text.Should().Be("5");

        picker.ValueEntry.Text = "";
        picker.ValueEntry.SendCompleted();
        picker.Value.Should().Be(5);
    }

    [Fact]
    public void CommitEntry_ValidText_ClampsAndApplies()
    {
        var picker = new NumberPicker { Minimum = 5, Maximum = 50, Increment = 5 };
        picker.ValueEntry.Text = "47";
        picker.ValueEntry.SendCompleted();
        picker.Value.Should().Be(45);
        picker.ValueEntry.Text.Should().Be("45");

        picker.ValueEntry.Text = "999";
        picker.ValueEntry.SendCompleted();
        picker.Value.Should().Be(50);
    }

    [Fact]
    public void CommitEntry_DecimalsRejected_WhenIntegerPicker()
    {
        var picker = new NumberPicker { Minimum = 1, Maximum = 100, FractionalDigits = 0 };
        picker.Value = 5;
        picker.ValueEntry.Text = "7.9";
        picker.ValueEntry.SendCompleted();
        picker.Value.Should().Be(8);
    }

    [Fact]
    public void RangeChange_RecoercesValue()
    {
        var picker = new NumberPicker { Minimum = 0, Maximum = 100 };
        picker.Value = 50;
        picker.Maximum = 20;
        picker.Value.Should().Be(20);
    }

    [Fact]
    public void FractionalDigits_PreservesDecimals()
    {
        var picker = new NumberPicker { Minimum = 0, Maximum = 10, Increment = 0.25, FractionalDigits = 2 };
        picker.Value = 1.1;
        picker.Value.Should().Be(1.0);
        picker.Value = 1.13;
        picker.Value.Should().Be(1.25);
        picker.ValueEntry.Text.Should().Be("1.25");
    }
}
