namespace BibleOnSite.Tests.MobileE2E.Configuration;

public enum MobilePlatform
{
    Android,
    IOS
}

public sealed record MobileTestConfiguration(
    MobilePlatform Platform, string AppPath, string DeviceId, string ArtifactDirectory, Uri Server)
{
    public string? PlatformVersion { get; init; }
    public string? PrebuiltWdaPath { get; init; }

    public static MobilePlatform ParsePlatform(string? value) => value?.ToLowerInvariant() switch
    {
        "android" => MobilePlatform.Android,
        "ios" => MobilePlatform.IOS,
        _ => throw new ArgumentException("MOBILE_PLATFORM must be Android or iOS.")
    };

    public static MobileTestConfiguration FromEnvironment()
    {
        var platform = ParsePlatform(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"));
        var appPath = Path.GetFullPath(Required("MOBILE_APP_PATH"));
        if (!File.Exists(appPath) && !Directory.Exists(appPath))
        {
            throw new FileNotFoundException("Build the simulator app with npm run build:app first.", appPath);
        }

        return new(platform, appPath, Required("MOBILE_UDID"),
            Path.GetFullPath(Required("MOBILE_E2E_ARTIFACTS")),
            new Uri(Environment.GetEnvironmentVariable("APPIUM_SERVER") ?? "http://127.0.0.1:4723"))
        {
            PlatformVersion = Environment.GetEnvironmentVariable("MOBILE_OS_VERSION"),
            PrebuiltWdaPath = platform == MobilePlatform.IOS ? Required("MOBILE_WDA_PATH") : null
        };
    }

    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value : throw new ArgumentException($"Set {name} before running mobile E2E tests.");
}
