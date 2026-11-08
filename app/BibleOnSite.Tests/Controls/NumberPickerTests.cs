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
    public void BoundValue_KeepsOffGridPrecision()
    {
        var picker = new NumberPicker { Minimum = 50, Maximum = 200, Increment = 5 };
        // A TwoWay binding push bypasses the CLR setter, so this path stands
        // in for a slider writing the same underlying setting (#2692 review):
        // the picker presents the precise value instead of snapping it onto
        // the increment grid and writing the snapped value back.
        picker.SetValue(NumberPicker.ValueProperty, 123);
        picker.Value.Should().Be(123);
        picker.ValueEntry.Text.Should().Be("123");

        picker.SetValue(NumberPicker.ValueProperty, 123.4);
        picker.Value.Should().Be(123.4);
        picker.ValueEntry.Text.Should().Be("123");
    }

    [Fact]
    public void Step_FromOffGridValue_LandsOnNextGridPoint()
    {
        var picker = new NumberPicker { Minimum = 50, Maximum = 200, Increment = 5 };
        picker.SetValue(NumberPicker.ValueProperty, 123);

        picker.IncrementButton.SendClicked();
        picker.Value.Should().Be(125);
        picker.DecrementButton.SendClicked();
        picker.Value.Should().Be(120);
    }

    [Fact]
    public void BoundValue_StillClampsOutOfRange()
    {
        var picker = new NumberPicker { Minimum = 1, Maximum = 100 };
        picker.SetValue(NumberPicker.ValueProperty, 250);
        picker.Value.Should().Be(100);
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
    public void NonFiniteValue_FallsBackToMinimum()
    {
        var picker = new NumberPicker { Minimum = 5, Maximum = 50 };
        picker.Value = double.NaN;
        picker.Value.Should().Be(5);
        picker.Value = double.PositiveInfinity;
        picker.Value.Should().Be(5);
    }

    [Fact]
    public void InvalidIncrementBoundDirectly_FallsBackToOne()
    {
        var picker = new NumberPicker { Minimum = 0, Maximum = 10 };
        // Bindable sets (XAML, bindings) bypass the CLR setter, so Coerce guards again.
        picker.SetValue(NumberPicker.IncrementProperty, 0.0);
        picker.Value = 3.6;
        picker.Value.Should().Be(4);
        picker.SetValue(NumberPicker.IncrementProperty, -2.0);
        picker.Value = 3.9;
        picker.Value.Should().Be(4);
    }

    [Fact]
    public void Step_WithInvalidIncrement_StepsByOne()
    {
        var picker = new NumberPicker { Minimum = 0, Maximum = 10 };
        picker.SetValue(NumberPicker.IncrementProperty, 0.0);
        picker.Value = 3;

        picker.IncrementButton.SendClicked();
        picker.Value.Should().Be(4);
        picker.DecrementButton.SendClicked();
        picker.Value.Should().Be(3);
    }

    [Fact]
    public void BoundValue_NonFinite_FallsBackToMinimum()
    {
        // A binding push of a non-finite value bypasses the CLR setter and
        // reaches OnValueChanged directly — it must clamp like the setter.
        var picker = new NumberPicker { Minimum = 5, Maximum = 50 };
        picker.SetValue(NumberPicker.ValueProperty, double.NaN);
        picker.Value.Should().Be(5);
        picker.SetValue(NumberPicker.ValueProperty, double.PositiveInfinity);
        picker.Value.Should().Be(5);
    }

    [Fact]
    public void IncrementSetter_RejectsZero()
    {
        var picker = new NumberPicker();
        picker.Increment = 0;
        picker.Increment.Should().Be(1);
    }

    [Fact]
    public void FractionalDigits_ClampsToSupportedRange()
    {
        var picker = new NumberPicker();
        picker.FractionalDigits = 9;
        picker.FractionalDigits.Should().Be(3);
        picker.FractionalDigits = -2;
        picker.FractionalDigits.Should().Be(0);
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
