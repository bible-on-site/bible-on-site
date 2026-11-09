#if FIREBASE_EMULATOR
using System.Globalization;

namespace BibleOnSite.Services;

/// <summary>
/// The resolved Firebase Emulator Suite endpoint shared by Auth and Firestore
/// (#3185). Only emulator-gated builds compile <see cref="FirebaseEmulatorConfig"/>;
/// production Debug/Release keep the real Firebase endpoints untouched.
/// </summary>
internal readonly record struct FirebaseEmulatorEndpoint(string Host, int AuthPort, int FirestorePort);

/// <summary>
/// Resolves where an emulator-gated build points Firebase Auth and Firestore.
/// Resolution order per value: environment variable → Android system property
/// → platform default. Environment variables cover iOS launch variables and
/// desktop runs; Android app processes cannot receive environment variables,
/// so the same names exist as <c>debug.bos.firebase.emulator.*</c> system
/// properties settable via <c>adb shell setprop</c> — the same override
/// channel the Plugin.Firebase integration-test suite uses.
/// </summary>
internal static class FirebaseEmulatorConfig
{
    internal const string HostEnvironmentVariable = "FIREBASE_EMULATOR_HOST";
    internal const string AuthPortEnvironmentVariable = "FIREBASE_EMULATOR_AUTH_PORT";
    internal const string FirestorePortEnvironmentVariable = "FIREBASE_EMULATOR_FIRESTORE_PORT";

    // Android system-property mirrors of the environment variables. Readable
    // synchronously by every app process; the reader below returns null on
    // other platforms, where these names are inert.
    internal const string HostSystemProperty = "debug.bos.firebase.emulator.host";
    internal const string AuthPortSystemProperty = "debug.bos.firebase.emulator.auth.port";
    internal const string FirestorePortSystemProperty = "debug.bos.firebase.emulator.firestore.port";

#if ANDROID
    // The Android emulator reaches the host machine's loopback through the
    // special 10.0.2.2 alias; a physical device needs an explicit override.
    internal const string DefaultHost = "10.0.2.2";
#else
    // The iOS simulator shares the host network stack, so the suite's
    // loopback address is directly reachable.
    internal const string DefaultHost = "localhost";
#endif

    internal const int DefaultAuthPort = 9099;
    internal const int DefaultFirestorePort = 8080;

    private static readonly Lazy<FirebaseEmulatorEndpoint> _current = new(() => Resolve(
        Environment.GetEnvironmentVariable, ReadSystemProperty));

    internal static FirebaseEmulatorEndpoint Current => _current.Value;

    /// <summary>
    /// Pure resolution for tests: each source is an optional lookup returning
    /// null when unset. Ports must parse as 1-65535 or the next source wins.
    /// </summary>
    internal static FirebaseEmulatorEndpoint Resolve(
        Func<string, string?>? environmentVariable,
        Func<string, string?>? systemProperty)
    {
        return new FirebaseEmulatorEndpoint(
            FirstText(
                environmentVariable?.Invoke(HostEnvironmentVariable),
                systemProperty?.Invoke(HostSystemProperty),
                DefaultHost),
            FirstPort(
                environmentVariable?.Invoke(AuthPortEnvironmentVariable),
                systemProperty?.Invoke(AuthPortSystemProperty),
                DefaultAuthPort),
            FirstPort(
                environmentVariable?.Invoke(FirestorePortEnvironmentVariable),
                systemProperty?.Invoke(FirestorePortSystemProperty),
                DefaultFirestorePort));
    }

    private static string? ReadSystemProperty(string name) =>
#if ANDROID
        ReadAndroidSystemProperty(name);
#else
        null;
#endif

#if ANDROID
    private static string? ReadAndroidSystemProperty(string name)
    {
        // android.os.SystemProperties.get via JNI: app processes cannot
        // receive environment variables, so adb-set debug.* properties are
        // the only per-device override channel.
        IntPtr? value = null;
        try
        {
            var propertiesClass = Android.Runtime.JNIEnv.FindClass("android/os/SystemProperties");
            var getMethodId = Android.Runtime.JNIEnv.GetStaticMethodID(
                propertiesClass, "get", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
            using var propertyName = new Java.Lang.String(name);
            using var defaultValue = new Java.Lang.String(string.Empty);
            value = Android.Runtime.JNIEnv.CallStaticObjectMethod(
                propertiesClass, getMethodId,
                new Android.Runtime.JValue(propertyName), new Android.Runtime.JValue(defaultValue));
            var text = Android.Runtime.JNIEnv.GetString(value.Value, Android.Runtime.JniHandleOwnership.DoNotTransfer);
            return string.IsNullOrEmpty(text) ? null : text;
        }
#pragma warning disable S2221 // Deliberate failure boundary: a JNI failure degrades to the default endpoint, never breaks sync.
        catch (Exception ex) //NOSONAR — the property layer is an optional override.
        {
#pragma warning restore S2221
            Console.Error.WriteLine($"[FirebaseEmulator] system property '{name}' unreadable ({ex.Message})");
            return null;
        }
        finally
        {
            if (value is { } pointer && pointer != IntPtr.Zero)
            {
                Android.Runtime.JNIEnv.DeleteLocalRef(pointer);
            }
        }
    }
#endif

    private static string FirstText(string? environment, string? systemProperty, string fallback) =>
        !string.IsNullOrWhiteSpace(environment) ? environment.Trim()
        : !string.IsNullOrWhiteSpace(systemProperty) ? systemProperty.Trim()
        : fallback;

    private static int FirstPort(string? environment, string? systemProperty, int fallback)
    {
        if (TryPort(environment, out var environmentPort))
        {
            return environmentPort;
        }
        if (TryPort(systemProperty, out var systemPropertyPort))
        {
            return systemPropertyPort;
        }
        return fallback;
    }

    private static bool TryPort(string? text, out int port)
    {
        port = 0;
        return !string.IsNullOrWhiteSpace(text)
            && int.TryParse(text.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out port)
            && port is > 0 and <= 65535;
    }
}
#endif
