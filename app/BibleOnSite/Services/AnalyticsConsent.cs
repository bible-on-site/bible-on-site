namespace BibleOnSite.Services;

/// <summary>
/// Analytics opt-in consent (#2400, Israeli Privacy Protection Law
/// Amendment 13): Firebase collection stays off until the user explicitly
/// grants it, and e2e-marked processes always resolve off so suite traffic
/// never reaches the production property.
/// </summary>
public static class AnalyticsConsent
{
    internal const string StorageKey = "analyticsConsent";
    internal const string GrantedValue = "granted";
    internal const string DeniedValue = "denied";

    public static bool IsGranted(IPreferencesStorage storage) =>
        storage.Get(StorageKey, "") == GrantedValue;

    /// <summary>
    /// True once the user answered the prompt or flipped the settings toggle.
    /// An unset or malformed key counts as never asked so the first-launch
    /// prompt still gets its answer.
    /// </summary>
    public static bool WasAsked(IPreferencesStorage storage)
    {
        var stored = storage.Get(StorageKey, "");
        return stored is GrantedValue or DeniedValue;
    }

    /// <summary>
    /// Whether this launch may enable Firebase collection. Callers resolve the
    /// e2e marker separately because the unit-test host has no
    /// FileSystem.AppDataDirectory for <see cref="SearchIndexService.IsE2eMarkedProcess"/>
    /// to probe.
    /// </summary>
    public static bool IsCollectionEnabled(IPreferencesStorage storage) =>
        IsCollectionEnabled(storage, SearchIndexService.IsE2eMarkedProcess());

    internal static bool IsCollectionEnabled(IPreferencesStorage storage, bool e2eMarked) =>
        !e2eMarked && IsGranted(storage);

    /// <summary>Persist the consent choice and push it to the SDK collection flag.</summary>
    public static void Save(IPreferencesStorage storage, bool granted)
    {
        storage.Set(StorageKey, granted ? GrantedValue : DeniedValue);
        ApplySdkCollection(storage);
    }

    /// <summary>
    /// Applies the stored choice to the Firebase collection flag mid-session
    /// (first-launch prompt, settings toggle). No-op off the mobile targets and
    /// under DISABLE_ANALYTICS, where collection is deactivated at build level;
    /// the stored value still decides the next launch.
    /// </summary>
    public static void ApplySdkCollection(IPreferencesStorage storage)
    {
#if (ANDROID || IOS) && !DISABLE_ANALYTICS
        try
        {
#if IOS
            if (!MauiProgram.IsFirebaseInitialized)
            {
                return;
            }
#endif
            Plugin.Firebase.Analytics.CrossFirebaseAnalytics.Current.IsAnalyticsCollectionEnabled =
                IsCollectionEnabled(storage);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Analytics] apply consent failed: {ex.Message}");
        }
#endif
    }
}
