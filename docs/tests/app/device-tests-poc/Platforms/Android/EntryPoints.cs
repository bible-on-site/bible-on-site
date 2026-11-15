using Android.App;
using Android.Content.PM;
using Android.Runtime;
using DeviceTestApp.Runner;
using Microsoft.Maui;

namespace DeviceTestApp;

[Application]
public class MainApplication : MauiApplication
{
    public MainApplication(IntPtr handle, JniHandleOwnership ownership) : base(handle, ownership) { }
    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true,
    ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode |
        ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize)]
public class MainActivity : MauiAppCompatActivity
{
}

[Instrumentation(Name = "com.bibleonsite.devicetests.TestInstrumentation")]
public class TestInstrumentation : MauiTestInstrumentation
{
    protected TestInstrumentation(IntPtr handle, JniHandleOwnership transfer) : base(handle, transfer) { }
}

[Activity(Name = "com.bibleonsite.devicetests.TestActivity", Theme = "@style/Maui.MainTheme.NoActionBar",
    ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode |
        ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize)]
public class TestActivity : MauiTestActivity
{
}
