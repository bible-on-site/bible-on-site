using Nuke.Common.IO;
using Xunit;

public sealed class DeviceTestsXHarnessTests
{
    // The XHarness run contract is pinned by string so a refactor cannot drop
    // the instrumentation name or the results path silently — a wrong
    // instrumentation makes XHarness launch the app instead of the runner.
    [Fact]
    public void ArgumentsNameThePackageInstrumentationApkAndResults()
    {
        var args = Build.XHarnessAndroidTestArguments(
            (AbsolutePath)"/work/app/BibleOnSite.DeviceTests/bin/Release/net11.0-android/com.bibleonsite.devicetests-Signed.apk",
            (AbsolutePath)"/work/app/.artifacts/mobile-e2e/android-device-tests/xharness",
            "emulator-5554");

        Assert.Contains("tool run xharness android test", args);
        Assert.Contains("--package-name com.bibleonsite.devicetests", args);
        Assert.Contains("--instrumentation com.bibleonsite.devicetests.TestInstrumentation", args);
        Assert.Contains("--device-id emulator-5554", args);
        Assert.Contains("com.bibleonsite.devicetests-Signed.apk", args);
        Assert.Contains("android-device-tests/xharness", args);
        Assert.Contains("--timeout 00:10:00", args);
    }

    [Fact]
    public void ArgumentsOmitTheDeviceSelectorWhenNoUdidIsExported()
    {
        var args = Build.XHarnessAndroidTestArguments(
            (AbsolutePath)"/work/apk/a-Signed.apk", (AbsolutePath)"/work/out", null);

        Assert.DoesNotContain("--device-id", args);
    }

    [Fact]
    public void ArgumentsQuotePathsWithSpaces()
    {
        var args = Build.XHarnessAndroidTestArguments(
            (AbsolutePath)"/work/space dir/a-Signed.apk", (AbsolutePath)"/work/space dir/out", null);

        Assert.Contains("--app \"/work/space dir/a-Signed.apk\"", args);
        Assert.Contains("--output-directory \"/work/space dir/out\"", args);
    }
}
