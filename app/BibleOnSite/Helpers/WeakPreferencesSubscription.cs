using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>The singleton preferences must not own the lifetime of reader screens.</summary>
internal static class WeakPreferencesSubscription
{
    internal static void Subscribe<T>(T target, PreferencesService preferences, Action<T> changed) where T : class
    {
        var reference = new WeakReference<T>(target);
        EventHandler? handler = null;
        handler = (_, _) =>
        {
            if (reference.TryGetTarget(out var current)) { changed(current); }
            else { preferences.PreferencesChanged -= handler; }
        };
        preferences.PreferencesChanged += handler;
    }
}
