#if ANDROID || IOS
using Plugin.Firebase.Firestore;

namespace BibleOnSite.Services;

/// <summary>
/// Firestore-backed <see cref="IPreferencesCloudStore"/> (#1095): one document
/// per user at <c>users/{uid}</c>, read/written as a plain dictionary so no
/// reflection serialization is needed under AOT. The security rules in
/// <c>app/firebase/firestore.rules</c> scope the path to
/// <c>request.auth.uid == userId</c>.
///
/// The Firestore SDK itself queues writes offline and retries, so failures
/// here mean genuinely unreachable state — the sync service keeps local
/// values and retries on the next change.
/// </summary>
public sealed class FirestorePreferencesStore : IPreferencesCloudStore
{
    private const string UsersCollection = "users";

    private static IDocumentReference DocumentFor(string userId) =>
        CrossFirebaseFirestore.Current.GetDocument($"{UsersCollection}/{userId}");

    public async Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken)
    {
        var snapshot = await DocumentFor(userId)
            .GetDocumentSnapshotAsync<Dictionary<string, object>>()
            .WaitAsync(cancellationToken);
        return PreferencesCloudCodec.FromFirestoreMap(snapshot.Data);
    }

    public async Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken)
    {
        // Merge(), not a plain set: only the fields this device merged are
        // written, so keys another device saved between our fetch and this
        // write survive instead of being overwritten by a stale snapshot.
        await DocumentFor(userId)
            .SetDataAsync(PreferencesCloudCodec.ToFirestoreMap(document), SetOptions.Merge())
            .WaitAsync(cancellationToken);
    }
}
#endif
