using System.Globalization;
using BibleOnSite.Converters;
using BibleOnSite.DeviceTests.Runner;
using BibleOnSite.Helpers;
using Microsoft.Maui.Platform;
using Xunit;

namespace BibleOnSite.DeviceTests.Tests;

// Assertions copied from the portable suite (app/BibleOnSite.Tests) against the
// same linked production sources: the portable net11.0 run executes them off-device,
// here they run inside the app on Android — parity is the baseline the
// device-only families build on.
public class ParityTests
{
    [Fact]
    public void a_marker_prepends_a_styled_span_before_the_pasuk_spans()
    {
        var qriSpan = new Span { Text = "קרי", TextColor = Colors.Gray, FontSize = 14 };
        var text = new FormattedString();
        text.Spans.Add(new Span { Text = "פסוק" });
        text.Spans.Add(qriSpan);

        // ResolvedMarkerColor follows the running app's RequestedTheme: on a
        // dark-mode device it selects MarkerColorDark, so both theme colors are
        // pinned to keep this assertion theme-independent.
        var merged = (FormattedString)new PasukMarkerTextConverter { MarkerColor = Colors.Red, MarkerColorDark = Colors.Red }
            .Convert(new object[] { text, "א", 16.0 }, typeof(object), null, CultureInfo.InvariantCulture);

        Assert.Equal(3, merged.Spans.Count);
        Assert.Equal("א ", merged.Spans[0].Text);
        Assert.Equal(FontAttributes.Bold, merged.Spans[0].FontAttributes);
        Assert.Equal(Colors.Red, merged.Spans[0].TextColor);
        Assert.Equal(16.0, merged.Spans[0].FontSize, 3);
    }

    [Theory]
    [InlineData(1, "א")]
    // GimatryHelperTests.cs documents these as the irregular spellings.
    [InlineData(15, "טו")]
    [InlineData(929, "תתקכט")]
    public void gimatry_converts_numbers_to_hebrew_letters(int number, string expected)
    {
        Assert.Equal(expected, GimatryHelper.ToLetters(number));
    }

    [Fact]
    public void gimatry_rejects_non_positive_numbers()
    {
        Assert.Equal(string.Empty, GimatryHelper.ToLetters(0));
        Assert.Equal(string.Empty, GimatryHelper.ToLetters(-3));
    }
}

// Below: families the portable suite cannot reach at all — real handlers, the
// XAML runtime, the platform layout engine, platform services and the UI thread.
public class DeviceOnlyTests
{
    static MauiContext TestMauiContext()
    {
        var activity = MauiTestInstrumentation.Current.CurrentExecutionContext as Android.App.Activity;
        return new MauiContext(MauiTestInstrumentation.Current.Services, activity!);
    }

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
    public void display_metrics_come_from_the_real_display()
    {
        var info = DeviceDisplay.Current.MainDisplayInfo;
        Assert.True(info.Width > 0 && info.Height > 0);
        Assert.True(info.Density > 0);
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
    public async Task nested_layout_inflates_from_xaml_with_children()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var layout = new VerticalStackLayout();
            layout.LoadFromXaml(
                "<VerticalStackLayout xmlns=\"http://schemas.microsoft.com/dotnet/2021/maui\">" +
                "<Label Text=\"א\" /><Label Text=\"ב\" /></VerticalStackLayout>");
            Assert.Equal(2, layout.Children.Count);
            Assert.Equal("א", ((Label)layout.Children[0]).Text);
        });
    }

    [Fact]
    public async Task handler_is_created_by_the_real_android_registry()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var mauiContext = TestMauiContext();
            var button = new Button { Text = "tap" };
            var handler = button.ToHandler(mauiContext);
            Assert.IsType<Microsoft.Maui.Handlers.ButtonHandler>(handler);
            Assert.NotNull(handler.PlatformView);
        });
    }

    [Fact]
    public async Task label_handler_maps_to_a_real_android_textview()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var mauiContext = TestMauiContext();
            var label = new Label { Text = "שלום" };
            var handler = label.ToHandler(mauiContext);
            Assert.IsType<Microsoft.Maui.Handlers.LabelHandler>(handler);
            Assert.IsAssignableFrom<Android.Widget.TextView>(handler.PlatformView);
        });
    }

    [Fact]
    public async Task measure_and_arrange_use_the_real_layout_engine()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var mauiContext = TestMauiContext();
            var label = new Label { Text = "בְּרֵאשִׁית בָּרָא" };
            var platformView = label.ToPlatform(mauiContext);
            platformView.Measure(
                Android.Views.View.MeasureSpec.MakeMeasureSpec(0, Android.Views.MeasureSpecMode.Unspecified),
                Android.Views.View.MeasureSpec.MakeMeasureSpec(0, Android.Views.MeasureSpecMode.Unspecified));
            Assert.True(platformView.MeasuredWidth > 0 && platformView.MeasuredHeight > 0);
            // Arrange: the name claims it, so assign real bounds and check the
            // platform view accepted them.
            platformView.Layout(0, 0, platformView.MeasuredWidth, platformView.MeasuredHeight);
            Assert.True(platformView.Width > 0 && platformView.Height > 0);
        });
    }

    [Fact]
    public async Task rtl_flow_direction_resolves_on_the_real_view_tree()
    {
        await MainThread.InvokeOnMainThreadAsync(async () =>
        {
            var activity = (Android.App.Activity)MauiTestInstrumentation.Current.CurrentExecutionContext!;
            var mauiContext = TestMauiContext();
            var layout = new HorizontalStackLayout { FlowDirection = FlowDirection.RightToLeft, WidthRequest = 400 };
            var label = new Label { Text = "א" };
            layout.Children.Add(label);
            var platformView = layout.ToPlatform(mauiContext);
            // On Android, FlowDirection maps to the platform LayoutDirection
            // (ViewExtensions.UpdateFlowDirection) — but only when the app
            // declares android:supportsRtl, otherwise setLayoutDirection is a
            // no-op. The managed stack arrange always counts from the left,
            // so positions are not the RTL observable here; the resolved
            // platform direction after a real window traversal is.
            using var layoutPass = new LayoutPassAwaiter(platformView);
            activity.SetContentView(platformView);
            await layoutPass.Task;
            Assert.Equal(Android.Views.LayoutDirection.Rtl, platformView.LayoutDirection);
            // The direction propagates down the real view hierarchy: the child
            // label inherits RTL without setting FlowDirection itself.
            var labelView = (Android.Views.View)label.Handler!.PlatformView!;
            Assert.Equal(Android.Views.LayoutDirection.Rtl, labelView.LayoutDirection);
        });
    }

    [Fact]
    public void preferences_roundtrip_through_shared_preferences()
    {
        const string key = "device-tests-pref-probe";
        Preferences.Remove(key);
        try
        {
            Preferences.Set(key, "ערך");
            Assert.True(Preferences.ContainsKey(key));
            Assert.Equal("ערך", Preferences.Get(key, string.Empty));
        }
        finally
        {
            Preferences.Remove(key);
        }
    }

    [Fact]
    public void filesystem_writes_and_reads_app_data_directory()
    {
        var path = Path.Combine(FileSystem.AppDataDirectory, "device-tests-probe.txt");
        File.WriteAllText(path, "בדיקה");
        try
        {
            Assert.True(File.Exists(path));
            Assert.Equal("בדיקה", File.ReadAllText(path));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task alert_dialog_shows_and_dismisses_on_the_test_activity()
    {
        // Popup coverage without a MAUI Window: the headless runner has no
        // Shell/NavigationPage window, so the platform popup the Appium layer
        // also relies on is asserted directly on the test activity.
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var activity = (AndroidX.AppCompat.App.AppCompatActivity)MauiTestInstrumentation.Current.CurrentExecutionContext!;
            using var dialog = new AndroidX.AppCompat.App.AlertDialog.Builder(activity)
                .SetTitle("probe")!
                .SetMessage("device popup")!
                .Show()!;
            Assert.True(dialog.IsShowing);
            dialog.Dismiss();
            Assert.False(dialog.IsShowing);
        });
    }

    [Fact]
    public async Task back_press_reaches_a_registered_dispatcher_callback()
    {
        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var activity = (AndroidX.AppCompat.App.AppCompatActivity)MauiTestInstrumentation.Current.CurrentExecutionContext!;
            using var probe = new BackPressProbe();
            activity.OnBackPressedDispatcher.AddCallback(activity, probe);
            activity.OnBackPressedDispatcher.OnBackPressed();
            Assert.True(probe.Handled);
            // Removing the probe must NOT be followed by another dispatch —
            // an unhandled back press finishes the test activity and kills the run.
            probe.Remove();
        });
    }

    [Fact]
    public async Task code_on_the_ui_thread_really_runs_there()
    {
        var onMain = await MainThread.InvokeOnMainThreadAsync(() => MainThread.IsMainThread);
        Assert.True(onMain);
    }

    [Fact]
    public async Task code_off_the_ui_thread_is_not_main_thread()
    {
        var onMain = await Task.Run(() => MainThread.IsMainThread);
        Assert.False(onMain);
    }

    class BackPressProbe : AndroidX.Activity.OnBackPressedCallback
    {
        public BackPressProbe()
            : base(true)
        {
        }

        public bool Handled { get; private set; }

        public override void HandleOnBackPressed() => Handled = true;
    }

    // Completes on the view's first real layout pass (ViewTreeObserver fires
    // after measure+arrange inside a window traversal).
    class LayoutPassAwaiter : Java.Lang.Object, Android.Views.ViewTreeObserver.IOnGlobalLayoutListener
    {
        readonly TaskCompletionSource _layout = new(TaskCreationOptions.RunContinuationsAsynchronously);
        readonly Android.Views.View _view;

        public LayoutPassAwaiter(Android.Views.View view)
        {
            _view = view;
            _view.ViewTreeObserver!.AddOnGlobalLayoutListener(this);
        }

        public Task Task => _layout.Task;

        public void OnGlobalLayout()
        {
            _view.ViewTreeObserver!.RemoveOnGlobalLayoutListener(this);
            _layout.TrySetResult();
        }
    }
}
