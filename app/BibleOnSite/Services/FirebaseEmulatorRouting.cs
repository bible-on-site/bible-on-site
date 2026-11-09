#if (ANDROID || IOS) && FIREBASE_EMULATOR
using Plugin.Firebase.Auth;
using Plugin.Firebase.Firestore;

namespace BibleOnSite.Services;

/// <summary>
/// Points the Firebase Auth and Firestore plugin singletons at the local
/// Emulator Suite (#3185). <c>UseEmulator</c> must run before the first real
/// call on each instance, so both native adapters funnel through here before
/// their first use — ordering is structural, not conventional. Emulator-gated
/// builds only; production Debug/Release never compile this type.
/// </summary>
internal static class FirebaseEmulatorRouting
{
    private static int _authApplied;
    private static int _firestoreApplied;

    internal static void ApplyToAuth(IFirebaseAuth auth)
    {
        if (Interlocked.Exchange(ref _authApplied, 1) == 0)
        {
            var endpoint = FirebaseEmulatorConfig.Current;
            auth.UseEmulator(endpoint.Host, endpoint.AuthPort);
        }
    }

    internal static void ApplyToFirestore(IFirebaseFirestore firestore)
    {
        if (Interlocked.Exchange(ref _firestoreApplied, 1) == 0)
        {
            var endpoint = FirebaseEmulatorConfig.Current;
            firestore.UseEmulator(endpoint.Host, endpoint.FirestorePort);
        }
    }
}
#endif
