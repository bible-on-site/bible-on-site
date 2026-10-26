using System.Globalization;
using BibleOnSite.Converters;
using BibleOnSite.Models;
using FluentAssertions;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Models;

/// <summary>
/// Dark-theme span colors for <see cref="Pasuk"/> formatted text (#2601). The
/// light-theme counterparts are covered by <c>PasukFormattedTextTests</c>.
/// </summary>
[Collection("Application state")]
public class PasukDarkThemeTests : IDisposable
{
	private readonly Application? _previousApp = Application.Current;

	public PasukDarkThemeTests()
	{
		Application.Current = new Application { UserAppTheme = AppTheme.Dark };
	}

	public void Dispose() => Application.Current = _previousApp;

	private static Pasuk PasukOf(params PasukSegment[] segments) => new()
	{
		PasukNum = 1,
		Text = string.Concat(segments.Select(s => s.Value)),
		Segments = [.. segments]
	};

	[Fact]
	public void qri_highlight_uses_light_accent_on_dark_fill()
	{
		var pasuk = PasukOf(
			new PasukSegment { Type = SegmentType.Qri, Value = "אור" },
			new PasukSegment { Type = SegmentType.Qri, Value = "חושך" });
		pasuk.RecitingSegment = 2;

		var active = pasuk.FormattedText.Spans.Single(s => s.BackgroundColor != null);
		active.TextColor.Should().Be(Color.FromArgb("#AACBFF"));
		active.BackgroundColor.Should().Be(Color.FromArgb("#2C4569"));
	}

	[Fact]
	public void selected_pasuk_reciting_highlight_tracks_the_dark_theme()
	{
		var pasuk = PasukOf(new PasukSegment { Type = SegmentType.Qri, Value = "אור" });
		pasuk.IsSelected = true;
		pasuk.RecitingSegment = 1;

		var span = pasuk.FormattedText.Spans.Single(s => s.BackgroundColor != null);
		span.BackgroundColor.Should().Be(Color.FromArgb("#3D5A80"));
		span.FontAttributes.Should().Be(FontAttributes.Bold);
	}

	[Fact]
	public void theme_change_invalidates_cached_formatted_text()
	{
		var pasuk = PasukOf(new PasukSegment { Type = SegmentType.Qri, Value = "אור" });
		pasuk.RecitingSegment = 1;
		Application.Current!.UserAppTheme = AppTheme.Light;
		var light = pasuk.FormattedText;
		light.Spans.Single(s => s.BackgroundColor != null).BackgroundColor
			.Should().Be(Color.FromArgb("#e9eff8"));
		var notified = false;
		pasuk.PropertyChanged += (_, e) => notified |= e.PropertyName == nameof(Pasuk.FormattedText);

		Application.Current!.UserAppTheme = AppTheme.Dark;
		pasuk.RefreshForThemeChange();

		notified.Should().BeTrue();
		pasuk.FormattedText.Should().NotBeSameAs(light);
		pasuk.FormattedText.Spans.Single(s => s.BackgroundColor != null).BackgroundColor
			.Should().Be(Color.FromArgb("#2C4569"));
	}

	[Fact]
	public void refresh_without_theme_change_keeps_the_cached_instance()
	{
		var pasuk = PasukOf(new PasukSegment { Type = SegmentType.Qri, Value = "אור" });
		var cached = pasuk.FormattedText;

		pasuk.RefreshForThemeChange();

		pasuk.FormattedText.Should().BeSameAs(cached);
	}

	[Fact]
	public void marker_converter_uses_dark_marker_color_and_caches_per_theme()
	{
		var formatted = new FormattedString();
		formatted.Spans.Add(new Span { Text = "אור" });
		var converter = new PasukMarkerTextConverter
		{
			MarkerColor = Colors.Red,
			MarkerColorDark = Colors.LightBlue
		};

		var dark = (FormattedString)converter.Convert(
			[formatted, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture)!;
		dark.Spans[0].TextColor.Should().Be(Colors.LightBlue);

		Application.Current!.UserAppTheme = AppTheme.Light;
		var light = (FormattedString)converter.Convert(
			[formatted, "א", 16.0], typeof(object), null, CultureInfo.InvariantCulture)!;
		light.Should().NotBeSameAs(dark, "theme is part of the merge cache key");
		light.Spans[0].TextColor.Should().Be(Colors.Red);
	}
}
