namespace BibleOnSite.Helpers;

/// <summary>A long-lived event source must not retain a closed screen.</summary>
internal static class WeakEventSubscription
{
    internal static void Subscribe<T, TSource>(T target, TSource source,
        Action<TSource, EventHandler> addHandler, Action<TSource, EventHandler> removeHandler,
        Action<T> changed) where T : class
    {
        var reference = new WeakReference<T>(target);
        EventHandler? handler = null;
        handler = (_, _) =>
        {
            if (reference.TryGetTarget(out var current)) { changed(current); }
            else { removeHandler(source, handler!); }
        };
        addHandler(source, handler);
    }
}
