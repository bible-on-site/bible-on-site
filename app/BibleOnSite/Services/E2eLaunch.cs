namespace BibleOnSite.Services;

/// <summary>
/// Marks a launch as E2E test traffic (#2120). The mobile suite signals every
/// session through the BIBLE_E2E channel the platform can carry: XCUITest
/// processArguments env on iOS, a launch-intent extra on Android. The first
/// marked launch persists a marker file so later relaunches in the same
/// install stay marked — Appium activateApp calls drop both extras and env —
/// and the file dies with the install, matching the suite's lifetime.
/// Consumers consult <see cref="IsMarked"/> to keep test runs out of
/// production analytics. Production launches never set the marker.
/// </summary>
internal static class E2eLaunch
{
    // Shared name for the environment variable and the Android intent extra.
    internal const string Variable = "BIBLE_E2E";

    private static bool _marked;

    // Tests substitute a temp directory; production resolves the app's data dir.
    internal static Func<string> MarkerDirectory = () => FileSystem.AppDataDirectory;
    private static string MarkerPath => Path.Combine(MarkerDirectory(), "e2e.launch");

    internal static bool IsMarked
    {
        get
        {
            if (_marked)
            {
                return true;
            }
            if (Environment.GetEnvironmentVariable(Variable) == "1")
            {
                Mark();
                return true;
            }
            try
            {
                return File.Exists(MarkerPath);
            }
            catch (Exception)
            {
                return false;
            }
        }
    }

    internal static void Mark()
    {
        // The in-process flag covers the current launch even if persistence
        // fails; the file only matters for later relaunches.
        _marked = true;
        try
        {
            File.WriteAllText(MarkerPath, "1");
        }
        catch (Exception exception)
        {
            Console.WriteLine($"[E2E] launch marker persist failed: {exception.Message}");
        }
    }

    internal static void ResetForTests()
    {
        _marked = false;
        MarkerDirectory = () => FileSystem.AppDataDirectory;
    }
}
