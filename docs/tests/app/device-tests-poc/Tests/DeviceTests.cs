using System.Globalization;
using BibleOnSite.Converters;
using DeviceTestApp.Runner;
using Microsoft.Maui.Platform;
using Xunit;

namespace DeviceTestApp.Tests;

// Assertions copied verbatim from app/BibleOnSite.Tests/Converters/PasukMarkerTextConverterTests.cs:
// the portable net10.0 suite runs them against linked sources; here they run inside the app on Android.
public class ParityTests
{
    [Fact]
    public void a_marker_prepends_a_styled_span_before_the_pasuk_spans()
    {
        var qriSpan = new Span { Text = "קרי", TextColor = Colors.Gray, FontSize = 14 };
        var text = new FormattedString();
        text.Spans.Add(new Span { Text = "פסוק" });
        text.Spans.Add(qriSpan);

        var merged = (FormattedString)new PasukMarkerTextConverter { MarkerColor = Colors.Red }
            .Convert(new object[] { text, "א", 16.0 }, typeof(object), null, CultureInfo.InvariantCulture);

        Assert.Equal(3, merged.Spans.Count);
        Assert.Equal("א ", merged.Spans[0].Text);
        Assert.Equal(FontAttributes.Bold, merged.Spans[0].FontAttributes);
        Assert.Equal(Colors.Red, merged.Spans[0].TextColor);
        Assert.Equal(16.0, merged.Spans[0].FontSize);
    }
}

// Below: families the portable suite cannot reach at all.
public class DeviceOnlyTests
{
    [Fact]
    public void deviceinfo_reports_a_real_android_platform()
    {
        Assert.Equal(DevicePlatform.Android, DeviceInfo.Platform);
        Assert.True(DeviceInfo.Version.Major >= 1);
        // Any emulator or physical device is valid — assert a real model string
        // rather than a specific image name.
        Assert.False(string.IsNullOrEmpty(DeviceInfo.Model));
        Assert.False(string.IsNullOrEmpty(DeviceInfo.Manufacturer));
    }

    [Fact]
    public void appinfo_matches_the_packaged_app_identity()
    {
        Assert.Equal("com.bibleonsite.devicetests", AppInfo.PackageName);
    }

    [Fact]
    public async Task controls_inflate_from_xaml_at_runtime()
    {
        // The portable suite excludes every *.xaml.cs because it cannot run the
        // XAML pipeline; on device the real loader inflates the markup.
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var label = new Label();
            label.LoadFromXaml("<Label xmlns=\"http://schemas.microsoft.com/dotnet/2021/maui\" Text=\"שלום\" />");
            Assert.Equal("שלום", label.Text);
        });
    }

    [Fact]
    public async Task handler_is_created_by_the_real_android_registry()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var activity = MauiTestInstrumentation.Current.CurrentExecutionContext as Android.App.Activity;
            var mauiContext = new MauiContext(MauiTestInstrumentation.Current.Services, activity!);
            var button = new Button { Text = "tap" };
            var handler = button.ToHandler(mauiContext);
            Assert.IsType<Microsoft.Maui.Handlers.ButtonHandler>(handler);
            Assert.NotNull(handler.PlatformView);
        });
    }

    [Fact]
    public async Task measure_and_arrange_use_the_real_layout_engine()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var activity = MauiTestInstrumentation.Current.CurrentExecutionContext as Android.App.Activity;
            var mauiContext = new MauiContext(MauiTestInstrumentation.Current.Services, activity!);
            var label = new Label { Text = "בְּרֵאשִׁית בָּרָא" };
            var platformView = label.ToPlatform(mauiContext);
            platformView.Measure(
                Android.Views.View.MeasureSpec.MakeMeasureSpec(0, Android.Views.MeasureSpecMode.Unspecified),
                Android.Views.View.MeasureSpec.MakeMeasureSpec(0, Android.Views.MeasureSpecMode.Unspecified));
            Assert.True(platformView.MeasuredWidth > 0 && platformView.MeasuredHeight > 0);
        });
    }

    [Fact]
    public async Task code_on_the_ui_thread_really_runs_there()
    {
        var onMain = await MainThread.InvokeOnMainThreadAsync(() => MainThread.IsMainThread);
        Assert.True(onMain);
    }
}
