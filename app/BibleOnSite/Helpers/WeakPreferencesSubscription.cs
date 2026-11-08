using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>The singleton preferences must not own the lifetime of reader screens.</summary>
internal static class WeakPreferencesSubscription
{
    internal static void Subscribe<T>(T target, PreferencesService preferences, Action<T> changed) where T : class
    {
        WeakEventSubscription.Subscribe(target, preferences,
            static (service, handler) => service.PreferencesChanged += handler,
            static (service, handler) => service.PreferencesChanged -= handler, changed);
    }
}
