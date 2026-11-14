#if ANDROID || IOS
using Plugin.Firebase.Auth;

namespace BibleOnSite.Services;

/// <summary>
/// Firebase Auth identity for preference sync (#1095): returns the signed-in
/// user's UID, or establishes an anonymous session so every install gets a
/// stable per-user Firestore document under <c>users/{uid}</c> — matching the
/// security rules' <c>request.auth.uid == userId</c> requirement. The app has
/// no login UI today; when a real provider ships, the already-signed-in
/// <c>CurrentUser</c> wins and the same sync path carries it.
///
/// Availability mirrors <see cref="AnalyticsService"/>: DISABLE_ANALYTICS
/// builds (Debug/e2e) never emit to Firebase, e2e-marked processes stay
/// signed out, and on iOS a failed Firebase init keeps the identity
/// anonymous — in every such case the app remains local-only.
/// </summary>
public sealed class FirebaseUserIdentity : IUserIdentity, IDisposable
{
    private readonly object _authGate = new();
    private IFirebaseAuth? _auth;
    private bool _authInitAttempted;
    private IDisposable? _authStateListener;

    /// <summary>Auth resolution is lazy: MauiProgram constructs this before the
    /// iOS Firebase init lifecycle callback runs, and the plugin entry point
    /// throws when the native app was never configured.</summary>
    private IFirebaseAuth? Auth
    {
        get
        {
            lock (_authGate)
            {
                if (_auth == null && !_authInitAttempted && FirebaseUsable)
                {
                    _authInitAttempted = true;
                    try
                    {
                        _auth = CrossFirebaseAuth.Current;
                        _authStateListener = _auth.AddAuthStateListener(
                            _ => UserChanged?.Invoke(this, EventArgs.Empty));
                    }
#pragma warning disable S2221 // Deliberate failure boundary: missing Firebase config leaves the app local-only.
                    catch (Exception ex) //NOSONAR — missing Firebase config leaves the app local-only.
                    {
#pragma warning restore S2221
                        Console.Error.WriteLine($"[PreferencesSync] Firebase Auth unavailable — staying local ({ex.Message})");
                    }
                }
                return _auth;
            }
        }
    }

    private static bool FirebaseUsable =>
#if DISABLE_ANALYTICS
        // Same build flag as analytics: test builds must not emit user data.
        false;
#elif IOS
        MauiProgram.IsFirebaseInitialized && !SearchIndexService.IsE2eMarkedProcess();
#else
        !SearchIndexService.IsE2eMarkedProcess();
#endif

    public string? UserId => FirebaseUsable ? Auth?.CurrentUser?.Uid : null;

    public event EventHandler? UserChanged;

    public async Task EnsureSignedInAsync(CancellationToken cancellationToken)
    {
        if (Auth is not { } auth || auth.CurrentUser != null)
        {
            return;
        }
        try
        {
            // Anonymous sign-in gives the install a real Firebase Auth session
            // (request.auth.uid is set) without collecting any user PII.
            await auth.SignInAnonymouslyAsync().WaitAsync(cancellationToken);
        }
#pragma warning disable S2221 // Deliberate failure boundary: sign-in failure leaves the app local-only.
        catch (Exception ex) when (ex is not OperationCanceledException) //NOSONAR — sign-in failure leaves the app local-only.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"[PreferencesSync] anonymous sign-in unavailable — staying local ({ex.Message})");
        }
    }

    public void Dispose()
    {
        lock (_authGate)
        {
            _authStateListener?.Dispose();
            _auth = null;
            _authInitAttempted = true;
        }
    }
}
#endif
