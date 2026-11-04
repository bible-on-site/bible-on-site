namespace BibleOnSite.Services;

/// <summary>
/// Remote persistence for the per-user preferences document (#1095). The
/// production implementation is <c>FirestorePreferencesStore</c>
/// (Android/iOS); unit tests substitute an in-memory fake so no network or
/// Firebase SDK is required.
/// </summary>
public interface IPreferencesCloudStore
{
    /// <summary>Returns the user's document, or null when none exists yet.
    /// Throws on transport/store failure — callers treat a throw as "offline,
    /// keep local".</summary>
    Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken);

    /// <summary>Overwrites the user's document with the merged result.</summary>
    Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken);
}

/// <summary>
/// Store for platforms/builds without Firebase: always "no document", and
/// saves are dropped. Paired with an anonymous-only identity the sync service
/// short-circuits before ever reaching it — this exists so the wiring never
/// passes null.
/// </summary>
public sealed class NullPreferencesCloudStore : IPreferencesCloudStore
{
    public static readonly NullPreferencesCloudStore Instance = new();

    private NullPreferencesCloudStore() { }

    public Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken) =>
        Task.FromResult<PreferencesCloudDocument?>(null);

    public Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}
