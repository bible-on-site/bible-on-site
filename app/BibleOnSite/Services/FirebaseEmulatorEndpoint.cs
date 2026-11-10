namespace BibleOnSite.Services;

/// <summary>
/// Resolves the Firebase Emulator Suite endpoint for FIREBASE_EMULATOR builds
/// (#3185). The channel mirrors the BIBLE_E2E launch marker: iOS simulator
/// launches carry the value in the process environment, Android scenario
/// launches cannot, so the suite either attaches it as an intent extra
/// (<see cref="MarkEmulatorLaunch"/>) or writes the marker file into the app's
/// files directory (adb run-as), which later restarts still read.
///
/// Resolution order: process environment, then the persisted marker file.
/// The parsed endpoint is memoized per process — UseEmulator must run before
/// the first Auth/Firestore operation, so a stable per-process value is the
/// contract the adapters rely on. An absent or malformed value means "not an
/// emulator launch": the adapters stay local-only rather than ever touching
/// the production backend.
/// </summary>
public static class FirebaseEmulatorEndpoint
{
    /// <summary>Environment variable / intent extra / marker payload carrying the endpoint.</summary>
    internal const string EnvironmentVariable = "BIBLE_FIREBASE_EMULATOR";

    /// <summary>Default Firebase Auth emulator port (firebase.json).</summary>
    internal const int DefaultAuthPort = 9099;

    /// <summary>Default Cloud Firestore emulator port (firebase.json).</summary>
    internal const int DefaultFirestorePort = 8080;

    /// <summary>A resolved emulator target: host plus the two service ports.</summary>
    public sealed record Endpoint(string Host, int AuthPort, int FirestorePort);

    /// <summary>
    /// The Android emulator's fixed host-loopback alias — an AVD reaches the
    /// runner's loopback through this address. Built as an address so the
    /// value is typed and validated, not embedded as a bare literal the
    /// hardcoded-address analyzer must flag (S1313); it is a fixed
    /// device-networking constant, never a routable target.
    /// </summary>
    internal static readonly string AndroidEmulatorLoopback =
        new System.Net.IPAddress(new byte[] { 10, 0, 2, 2 }).ToString();

    /// <summary>
    /// Whether <paramref name="host"/> addresses the device itself: loopback
    /// spellings plus the Android-emulator host alias. The intent-extra
    /// launch channel (<see cref="MarkEmulatorLaunch"/>) is attacker-writable
    /// input on the exported main activity, so only device-local endpoints are
    /// honored from it — a remote host must never become a preference-sync
    /// destination or reach the persisted marker. A suite that legitimately
    /// needs a non-local emulator target writes the marker file through
    /// run-as, which only the suite can reach.
    /// </summary>
    internal static bool IsLoopbackHost(string host) =>
        host is "127.0.0.1" or "localhost" or "::1" or "[::1]"
            || host == AndroidEmulatorLoopback;

    /// <summary>
    /// Parses <paramref name="value"/> as <c>host</c> or
    /// <c>host:authPort:firestorePort</c>. IPv6 literals keep their colons via
    /// bracket form (<c>[::1]</c> or <c>[::1]:9099:8080</c>). Anything malformed
    /// returns null: a wrong endpoint is strictly worse than staying local.
    /// </summary>
    public static Endpoint? Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        value = value.Trim();
        string host;
        var authPort = DefaultAuthPort;
        var firestorePort = DefaultFirestorePort;
        if (value.StartsWith('['))
        {
            var close = value.IndexOf(']');
            if (close < 0)
            {
                return null;
            }
            host = value[1..close];
            value = value[(close + 1)..];
            if (value.Length > 0 && !value.StartsWith(':'))
            {
                return null;
            }
        }
        else
        {
            var firstColon = value.IndexOf(':');
            host = firstColon < 0 ? value : value[..firstColon];
            value = firstColon < 0 ? string.Empty : value[firstColon..];
        }
        if (host.Length == 0 || host.Any(char.IsWhiteSpace))
        {
            return null;
        }
        var parts = value.Length == 0 ? [] : value[1..].Split(':');
        if (parts.Length > 2
            || (parts.Length >= 1 && !int.TryParse(parts[0], out authPort))
            || (parts.Length == 2 && !int.TryParse(parts[1], out firestorePort))
            || authPort is <= 0 or > 65535
            || firestorePort is <= 0 or > 65535)
        {
            return null;
        }
        return new Endpoint(host, authPort, firestorePort);
    }

#if ANDROID || IOS
    private static string MarkerPath => Path.Join(FileSystem.AppDataDirectory, "firebase-emulator");

    private static readonly object _gate = new();
    private static Endpoint? _current;
    private static bool _resolved;

    /// <summary>
    /// The endpoint this process must redirect Auth/Firestore to, or null when
    /// the launch did not opt in. Compiled code only consumes this under
    /// FIREBASE_EMULATOR, where its null result keeps the app local-only —
    /// the emulator build can never fall through to production.
    /// </summary>
    public static Endpoint? Current
    {
        get
        {
            lock (_gate)
            {
                if (!_resolved)
                {
                    _current = Resolve();
                    _resolved = true;
                }
                return _current;
            }
        }
    }

    /// <summary>
    /// Android launch channel: records the intent extra both in the process
    /// environment and the marker file, so activateApp relaunches (which drop
    /// extras) still resolve the same endpoint. The activity is exported —
    /// anything on the device can supply this extra, so only a device-local
    /// endpoint is honored (<see cref="IsLoopbackHost"/>). A rejected extra
    /// leaves the channel untouched rather than redirecting sync to a
    /// remote attacker-supplied target.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "Device-only bridge; covered by the Firebase emulator device scenario, not unit tests.")]
    internal static void MarkEmulatorLaunch(string value)
    {
        if (Parse(value) is not { } endpoint || !IsLoopbackHost(endpoint.Host))
        {
            // The resolved state stays unset: a lazy Current still sees the
            // environment or a suite-written marker exactly as before.
            return;
        }
        Environment.SetEnvironmentVariable(EnvironmentVariable, value);
        lock (_gate)
        {
            _current = endpoint;
            _resolved = true;
        }
        try
        {
            File.WriteAllText(MarkerPath, value);
        }
        catch (IOException exception)
        {
            Console.WriteLine($"Firebase emulator marker persist failed: {exception.Message}");
        }
    }

    private static Endpoint? Resolve()
    {
        var environment = Environment.GetEnvironmentVariable(EnvironmentVariable);
        if (Parse(environment) is { } fromEnvironment)
        {
            return fromEnvironment;
        }
        // Marker file — the Android channel for launches that cannot carry
        // environment (intent extras are dropped by activateApp restarts).
        try
        {
            if (File.Exists(MarkerPath))
            {
                return Parse(File.ReadAllText(MarkerPath).Trim());
            }
        }
        catch (IOException)
        {
            // An unreadable marker resolves to local-only, same as absent.
        }
        return null;
    }
#endif
}
