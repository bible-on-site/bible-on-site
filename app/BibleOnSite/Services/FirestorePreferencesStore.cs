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

#if FIREBASE_EMULATOR
    private static int _emulatorConfigured;

    // #3185: UseEmulator must run before any Firestore operation, so the first
    // document access performs it exactly once. The launch channel must have
    // resolved an endpoint already (the identity gate guarantees it); a null
    // endpoint here is a wiring bug — throwing keeps an emulator build from
    // ever reaching the production backend by accident.
    private static IFirebaseFirestore Store
    {
        [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
            Justification = "Emulator-gated device path; covered by the Firebase emulator device scenario, not unit tests.")]
        get
        {
            var store = CrossFirebaseFirestore.Current;
            if (Interlocked.Exchange(ref _emulatorConfigured, 1) == 0)
            {
                var endpoint = FirebaseEmulatorEndpoint.Current
                    ?? throw new InvalidOperationException(
                        "FIREBASE_EMULATOR build reached Firestore without a resolved emulator endpoint.");
                FirebaseEmulatorRedirect.UseFirestoreEmulator(endpoint);
            }
            return store;
        }
    }
#else
    private static IFirebaseFirestore Store => CrossFirebaseFirestore.Current;
#endif

    private static IDocumentReference DocumentFor(string userId) =>
        Store.GetDocument($"{UsersCollection}/{userId}");

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
