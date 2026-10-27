using BibleOnSite.Controls;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Flyout destination row contract (#2766): identical content layout on
/// every platform; a single <c>Activated</c> event driven by a tap
/// recognizer on touch platforms and by the native Button on Windows.
/// </summary>
public class FlyoutMenuRowTests
{
    [Fact]
    public void Ctor_BuildsIconTitleSubtitleChevron()
    {
        var row = new FlyoutMenuRow { Icon = "\uE000", Title = "כותרת", Subtitle = "כותרת משנה" };

        var grid = row.Content.Should().BeOfType<Grid>().Subject;
        grid.ColumnDefinitions.Should().HaveCount(3);
        var icon = grid.Children.OfType<Label>().First();
        icon.Text.Should().Be("\uE000");
        var textColumn = grid.Children.OfType<VerticalStackLayout>().Single();
        var labels = textColumn.Children.OfType<Label>().ToList();
        labels[0].Text.Should().Be("כותרת");
        labels[1].Text.Should().Be("כותרת משנה");
    }

    [Fact]
    public void Activated_RaisedBySendActivated()
    {
        var row = new FlyoutMenuRow();
        var count = 0;
        object? sender = null;
        row.Activated += (s, _) => { count++; sender = s; };

        row.SendActivated();

        count.Should().Be(1);
        sender.Should().BeSameAs(row);
    }

    [Fact]
    public void TapRecognizer_ActivatesTheRow()
    {
#if WINDOWS
        // On Windows the platform Button owns activation; no tap recognizer.
        new FlyoutMenuRow().GestureRecognizers.Should().BeEmpty();
#else
        var row = new FlyoutMenuRow();
        var count = 0;
        row.Activated += (_, _) => count++;

        var tap = row.GestureRecognizers.OfType<TapGestureRecognizer>().Should().ContainSingle().Subject;
        typeof(TapGestureRecognizer)
            .GetMethod("SendTapped", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .Invoke(tap, [row, null]);

        count.Should().Be(1);
#endif
    }

    [Fact]
    public void Activated_WithoutSubscribers_IsSafe()
    {
        var act = () => new FlyoutMenuRow().SendActivated();
        act.Should().NotThrow();
    }

    [Fact]
    public void EmptySubtitle_HidesTheSubtitleLabel()
    {
        var row = new FlyoutMenuRow { Title = "כותרת" };
        var textColumn = ((Grid)row.Content!).Children.OfType<VerticalStackLayout>().Single();
        var subtitle = textColumn.Children.OfType<Label>().ElementAt(1);
        // Bound visibility: the label exists but stays hidden until a
        // subtitle is supplied.
        subtitle.IsVisible.Should().BeFalse();
        row.Subtitle = "כותרת משנה";
        subtitle.IsVisible.Should().BeTrue();
    }
}
