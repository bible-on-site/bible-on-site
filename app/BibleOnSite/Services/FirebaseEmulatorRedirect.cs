#if FIREBASE_EMULATOR
namespace BibleOnSite.Services;

/// <summary>
/// Redirects the native Firebase SDKs at the Emulator Suite (#3185).
/// Plugin.Firebase exposes no emulator surface, so the redirect calls the
/// platform binding on the exact singleton the plugin wraps
/// (<c>FirebaseAuth.Instance</c> / <c>Auth.DefaultInstance</c>,
/// <c>FirebaseFirestore.Instance</c> / <c>Firestore.SharedInstance</c>) —
/// every later plugin operation, including the anonymous sign-in and the
/// <c>users/{uid}</c> document traffic, lands on the local suite.
/// The native SDKs accept the redirect only before their first operation;
/// the call sites run it ahead of any Auth or Firestore request.
/// </summary>
internal static class FirebaseEmulatorRedirect
{
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "Emulator-gated device path; covered by the Firebase emulator device scenario, not unit tests.")]
    public static void UseAuthEmulator(FirebaseEmulatorEndpoint.Endpoint endpoint)
    {
#if ANDROID
        global::Firebase.Auth.FirebaseAuth.Instance.UseEmulator(endpoint.Host, endpoint.AuthPort);
#elif IOS
        // DefaultInstance is null until CrossFirebase.Initialize configures
        // the app — a null here is an ordering bug, not a fallback case.
        var auth = global::Firebase.Auth.Auth.DefaultInstance
            ?? throw new InvalidOperationException(
                "FIREBASE_EMULATOR iOS Auth redirect reached before CrossFirebase.Initialize.");
        auth.UseEmulatorWithHost(endpoint.Host, endpoint.AuthPort);
#endif
    }

    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "Emulator-gated device path; covered by the Firebase emulator device scenario, not unit tests.")]
    public static void UseFirestoreEmulator(FirebaseEmulatorEndpoint.Endpoint endpoint)
    {
#if ANDROID
        global::Firebase.Firestore.FirebaseFirestore.Instance.UseEmulator(endpoint.Host, endpoint.FirestorePort);
#elif IOS
        // The iOS binding takes an unsigned port; the parser already bounds
        // the value to 1..65535.
        global::Firebase.CloudFirestore.Firestore.SharedInstance
            .UseEmulatorWithHost(endpoint.Host, (uint)endpoint.FirestorePort);
#endif
    }
}
#endif
