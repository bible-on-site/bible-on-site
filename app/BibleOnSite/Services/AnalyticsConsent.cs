namespace BibleOnSite.Services;

/// <summary>
/// Analytics choices for the Israeli service (#2400). Collection starts after
/// informed continued use or a settings grant. A refusal always wins, and
/// e2e-marked processes never reach the production property.
/// </summary>
public static class AnalyticsConsent
{
    // The short-lived launch-dialog choices used analyticsConsent. The new
    // notice scheme starts fresh and ignores that retired preference.
    internal const string StorageKey = "analyticsPreferenceV2";
    internal const string GrantedValue = "granted";
    internal const string DeniedValue = "denied";
    internal const string ContinuedUseValue = "notice-v1";

    public static bool IsGranted(IPreferencesStorage storage) =>
        storage.Get(StorageKey, "") == GrantedValue;

    /// <summary>
    /// True after informed continued use or an explicit settings choice.
    /// An unset or malformed key still requires the entry disclosure.
    /// </summary>
    public static bool WasAsked(IPreferencesStorage storage)
    {
        var stored = storage.Get(StorageKey, "");
        return stored is GrantedValue or DeniedValue or ContinuedUseValue;
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
        !e2eMarked && storage.Get(StorageKey, "") is GrantedValue or ContinuedUseValue;

    /// <summary>
    /// Records a subsequent reader interaction only after the disclosure was
    /// shown. It cannot replace a previous explicit grant or refusal.
    /// </summary>
    public static bool RecordContinuedUse(IPreferencesStorage storage, bool noticeShown)
    {
        if (!noticeShown || WasAsked(storage))
        {
            return false;
        }

        storage.Set(StorageKey, ContinuedUseValue);
        ApplySdkCollection(storage);
        return true;
    }

    /// <summary>Persist the consent choice and push it to the SDK collection flag.</summary>
    public static void Save(IPreferencesStorage storage, bool granted)
    {
        storage.Set(StorageKey, granted ? GrantedValue : DeniedValue);
        ApplySdkCollection(storage);
    }

    /// <summary>
    /// Applies the stored choice to the Firebase collection flag mid-session
    /// (informed continued use, settings toggle). No-op off the mobile targets and
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
