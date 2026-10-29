namespace BibleOnSite.Helpers;

/// <summary>
/// Whether the platform allows app-driven motion. iOS honors Reduce Motion;
/// Android's accessibility "remove animations" zeroes the animator scale.
/// Extracted from <see cref="ReaderScrollTop"/> so non-reader surfaces honor
/// the same setting (#2806).
/// </summary>
internal static class MotionPreferences
{
    internal static bool PlatformPrefersMotion()
    {
#if IOS || MACCATALYST
        return !UIKit.UIAccessibility.IsReduceMotionEnabled;
#elif ANDROID
        // The accessibility "remove animations" setting zeroes the animator
        // scale; when it does, land the scroll instantly instead of animating.
        var context = Platform.CurrentActivity ?? Android.App.Application.Context;
        var scale = context?.ContentResolver is { } resolver
            ? Android.Provider.Settings.Global.GetFloat(resolver,
                Android.Provider.Settings.Global.AnimatorDurationScale, 1f)
            : 1f;
        return scale > 0f;
#else
        return true;
#endif
    }
}
