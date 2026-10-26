using BibleOnSite.Controls;
using BibleOnSite.Helpers;
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

    // #2623: the shared scripture contract — every pasuk label renders Taamey
    // D. The ctor sets it as a local value so the implicit Label style's
    // OpenSansRegular can never win; spans without their own family inherit it.
    [Fact]
    public void defaults_to_the_scripture_font_family()
    {
        new PasukTextLabel().FontFamily.Should().Be(ScriptureFonts.Family);
    }

    [Fact]
    public void spans_without_a_family_inherit_the_scripture_face()
    {
        // The whole formatted-text path (qri/ktiv, reciting words, {פ}/{ס},
        // pasuk-number markers) leaves Span.FontFamily unset — pin that the
        // label face is the only one they can resolve to.
        var label = new PasukTextLabel();
        var span = new Span { Text = "א" };

        span.FontFamily.Should().BeNull();
        label.FontFamily.Should().Be(ScriptureFonts.Family);
    }

    // #2402: the reader's pasuk text is fully justified like the commentary
    // below it. Platform handlers read this flag to apply their native
    // justification (JustificationMode / NSParagraphStyle / TextAlignment).
    [Fact]
    public void justify_defaults_to_true()
    {
        new PasukTextLabel().Justify.Should().BeTrue();
    }

    [Fact]
    public void a_justify_change_notifies_so_handlers_reapply_alignment()
    {
        var label = new PasukTextLabel();
        var notified = false;
        label.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PasukTextLabel.Justify))
            {
                notified = true;
            }
        };

        label.Justify = false;

        notified.Should().BeTrue();
        label.Justify.Should().BeFalse();
    }
}
