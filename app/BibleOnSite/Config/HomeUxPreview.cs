namespace BibleOnSite.Config;

/// <summary>Explicit Debug build opt-in; ordinary builds keep their existing startup.</summary>
public static class HomeUxPreview
{
#if BIBLEONSITE_UNIT_TESTS
    // Compiled only in the host test harness; native builds have no runtime override.
    internal static bool? TestEnabled { get; set; }
#endif
    public static bool Enabled =>
#if BIBLEONSITE_UNIT_TESTS
        TestEnabled ??
#endif
#if HOME_UX_PREVIEW
        true;
#else
        false;
#endif
}
