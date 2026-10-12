using BibleOnSite.Controls;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// The label re-raises <see cref="Label.FormattedText"/> whenever its font size
/// changes, so Android's spannable re-bakes spans at the resolved size instead of
/// keeping the stale size it was converted with (#2070).
/// </summary>
public class PasukTextLabelTests
{
    [Fact]
    public void a_font_size_change_re_notifies_formatted_text()
    {
        var label = new PasukTextLabel
        {
            FormattedText = new FormattedString { Spans = { new Span { Text = "א" } } }
        };
        var reRendered = false;
        label.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Label.FormattedText))
            {
                reRendered = true;
            }
        };

        label.FontSize = 24;

        reRendered.Should().BeTrue();
    }

    [Fact]
    public void font_size_change_without_formatted_text_does_not_renotify()
    {
        var label = new PasukTextLabel();
        var reRendered = false;
        label.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Label.FormattedText))
            {
                reRendered = true;
            }
        };

        label.FontSize = 24;

        reRendered.Should().BeFalse();
    }
}
