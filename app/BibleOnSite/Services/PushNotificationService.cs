using BibleOnSite.Config;
using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

/// <summary>The notification authorization state reported by the platform.</summary>
public enum PushPermissionState
{
    /// <summary>The platform cannot deliver pushes (desktop, missing Play services).</summary>
    Unsupported,
    /// <summary>Notifications are authorized.</summary>
    Granted,
    /// <summary>The platform has not settled authorization; a request may prompt.</summary>
    NotDetermined,
    /// <summary>The user denied authorization; enabling needs system settings.</summary>
    Denied,
}

/// <summary>The outcome of an opt-in/out request through <see cref="PushNotificationService"/>.</summary>
public enum PushEnableResult
{
    Enabled,
    Disabled,
    PermissionDenied,
    Unsupported,
    Failed,
}

/// <summary>Device-registration row for the documented
/// <c>POST /api/push/device</c> contract (backend deferred — see
/// docs/app/push-notifications.md). <paramref name="UserId"/> is the durable
/// notification identity (seeded from the Firebase Installation ID and kept
/// stable across reinstalls where the platform store allows); a rotating
/// installation/FCM token re-links to it on every registration.</summary>
public sealed record PushDeviceRegistration(
    string UserId,
    string InstallationId,
    string Token,
    string Platform,
    IReadOnlyCollection<string> Topics,
    string AppVersion);

/// <summary>
/// Platform boundary for push delivery. Firebase/APNs implementations live
/// under <c>Platforms/</c>; unit tests substitute a fake.
/// </summary>
public interface IPushPlatformClient
{
    /// <summary>True when the platform can receive pushes at all.</summary>
    bool IsSupported { get; }

    /// <summary>One-time platform setup: delegate wiring, notification channel.</summary>
    Task InitializeAsync(CancellationToken ct);

    /// <summary>Current notification authorization without prompting.</summary>
    Task<PushPermissionState> GetPermissionStateAsync(CancellationToken ct);

    /// <summary>Requests notification authorization where the platform prompts.</summary>
    Task<PushPermissionState> RequestPermissionAsync(CancellationToken ct);

    /// <summary>The current FCM registration token, when fetchable.</summary>
    Task<string?> GetTokenAsync(CancellationToken ct);

    /// <summary>The Firebase Installation ID (FID), when fetchable.</summary>
    Task<string?> GetInstallationIdAsync(CancellationToken ct);

    Task SubscribeToTopicAsync(string topic, CancellationToken ct);
    Task UnsubscribeFromTopicAsync(string topic, CancellationToken ct);

    /// <summary>Raised with the notification data payload when the user taps a push.</summary>
    event EventHandler<IReadOnlyDictionary<string, string>>? NotificationTapped;

    /// <summary>Raised when the FCM registration token rotates.</summary>
    event EventHandler<string>? TokenRefreshed;
}

/// <summary>
/// Durable per-key storage for push state that must survive what plain app
/// storage does not: iOS uses Keychain (survives reinstall), Android uses
/// preferences (restored by Auto Backup) — per the no-Advertising-ID design in
/// the #1097 discussion.
/// </summary>
public interface IPushStateStore
{
    Task<string?> GetAsync(string key, CancellationToken ct);
    Task SetAsync(string key, string value, CancellationToken ct);
    Task RemoveAsync(string key, CancellationToken ct);
}

/// <summary>
/// Best-effort device registration against the documented
/// <c>POST/DELETE /api/push/device</c> contract. Calls throw on transport or
/// non-success responses; <see cref="PushNotificationService"/> treats them as
/// log-only because the backend is not yet deployed (deferred — see
/// docs/app/push-notifications.md).
/// </summary>
public interface IPushDeviceRegistry
{
    Task RegisterAsync(PushDeviceRegistration registration, CancellationToken ct);
    Task UnregisterAsync(string userId, CancellationToken ct);
}

/// <summary>
/// The push-notification surface view-models and app wiring consume. Kept
/// narrow so tests can substitute a fake; <see cref="PushNotificationService"/>
/// is the production implementation.
/// </summary>
public interface IPushNotificationService
{
    /// <summary>True when this platform/build can receive push notifications.</summary>
    bool IsSupported { get; }

    /// <summary>The last captured FCM registration token (diagnostics).</summary>
    string? CurrentToken { get; }

    /// <summary>The durable notification user identity (FID-seeded).</summary>
    string? NotificationUserId { get; }

    /// <summary>Applies the user's opt-in/out choice — see the implementation for flow.</summary>
    Task<PushEnableResult> SetEnabledAsync(bool enabled, CancellationToken ct);

    /// <summary>Re-applies the stored opt-in at startup (idempotent, once per launch).</summary>
    Task ApplyEnabledPreferenceAsync(CancellationToken ct);

    /// <summary>Routes a tapped notification's data payload into app navigation.</summary>
    void DispatchNotificationTap(IReadOnlyDictionary<string, string>? data);

    /// <summary>One-time platform setup (notification channel, delegate wiring).</summary>
    Task EnsureInitializedAsync(CancellationToken ct);
}

/// <summary>
/// Push notification lifecycle (#1097): opt-in topic subscription to the daily
/// perek, token and identity capture for the device-registration contract, and
/// deep-link routing of notification taps through <see cref="AppLinkHelper"/>.
/// All platform work sits behind <see cref="IPushPlatformClient"/>; on
/// unsupported platforms and DISABLE_PUSH builds the client is a no-op.
/// </summary>
public sealed class PushNotificationService : IPushNotificationService, IDisposable
{
    /// <summary>FCM topic for the daily-perek notification (also the Android channel id).</summary>
    public static string DailyPerekTopic => "daily_perek";

    private const string UrlDataKey = "url";
    private const string UserIdKey = "push.user_id";
    private const string RegistrationFingerprintKey = "push.registration_fingerprint";
    private const string PendingUnsubscribeKey = "push.pending_unsubscribe";

    private static PushNotificationService? _instance;

    /// <summary>Shared instance. For tests, use <see cref="CreateForTesting(IPushPlatformClient, PreferencesService, IPushStateStore, IPushDeviceRegistry, Func{string})"/>.</summary>
    public static PushNotificationService Instance => _instance ??= CreateDefault();

    internal static void ResetForTesting() => _instance = null;

    private readonly IPushPlatformClient _platform;
    private readonly PreferencesService _preferences;
    private readonly IPushStateStore _stateStore;
    private readonly IPushDeviceRegistry _registry;
    private readonly Func<string> _appVersion;
    private readonly object _initLock = new();
    private Task? _initializeTask;
    private Task? _tokenResync;
    private bool _appliedThisLaunch;
    private string? _installationId;
    private string? _token;
    private string? _userId;

    public PushNotificationService(
        IPushPlatformClient platform,
        PreferencesService preferences,
        IPushStateStore stateStore,
        IPushDeviceRegistry registry,
        Func<string> appVersion)
    {
        _platform = platform ?? throw new ArgumentNullException(nameof(platform));
        _preferences = preferences ?? throw new ArgumentNullException(nameof(preferences));
        _stateStore = stateStore ?? throw new ArgumentNullException(nameof(stateStore));
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        _appVersion = appVersion ?? throw new ArgumentNullException(nameof(appVersion));
        _platform.NotificationTapped += OnPlatformNotificationTapped;
        _platform.TokenRefreshed += OnPlatformTokenRefreshed;
    }

    public static PushNotificationService CreateForTesting(
        IPushPlatformClient platform,
        PreferencesService preferences,
        IPushStateStore stateStore,
        IPushDeviceRegistry registry,
        Func<string> appVersion) =>
        new(platform, preferences, stateStore, registry, appVersion);

    /// <summary>True when this platform/build can receive push notifications.</summary>
    public bool IsSupported => _platform.IsSupported;

    /// <summary>The last captured FCM registration token (diagnostics).</summary>
    public string? CurrentToken => _token;

    /// <summary>The durable notification user identity (FID-seeded).</summary>
    public string? NotificationUserId => _userId;

    /// <summary>The in-flight resync a token refresh kicked off — test seam so
    /// callers can await the settled registration instead of polling.</summary>
    internal Task? LastTokenResync => _tokenResync;

    /// <summary>
    /// Opt-in: verifies or requests notification authorization, subscribes the
    /// daily-perek topic, then syncs the device-registration row. Opt-out
    /// unsubscribes and unregisters. The preference is only written after the
    /// platform side succeeds so a failure never leaves a lying toggle.
    /// </summary>
    public async Task<PushEnableResult> SetEnabledAsync(bool enabled, CancellationToken ct)
    {
        if (!IsSupported)
        {
            return PushEnableResult.Unsupported;
        }
        try
        {
            await EnsureInitializedAsync(ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: platform init failure degrades push, not the app
        catch (Exception ex) //NOSONAR — platform init failure degrades push, not the app.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] platform init failed: {ex.Message}");
            return PushEnableResult.Failed;
        }
        return enabled ? await EnableAsync(ct) : await DisableAsync(ct);
    }

    private async Task<PushEnableResult> EnableAsync(CancellationToken ct)
    {
        var permission = await _platform.GetPermissionStateAsync(ct);
        if (permission == PushPermissionState.NotDetermined)
        {
            permission = await _platform.RequestPermissionAsync(ct);
        }
        if (permission == PushPermissionState.Denied)
        {
            return PushEnableResult.PermissionDenied;
        }
        if (permission == PushPermissionState.Unsupported)
        {
            return PushEnableResult.Unsupported;
        }
        try
        {
            await _platform.SubscribeToTopicAsync(DailyPerekTopic, ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: subscribe failure reports Failed to the caller
        catch (Exception ex) //NOSONAR — subscribe failure reports Failed to the caller.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] topic subscribe failed: {ex.Message}");
            return PushEnableResult.Failed;
        }
        _preferences.DailyPerekPushEnabled = true;
        _appliedThisLaunch = true;
        // A successful (re-)subscribe supersedes any deferred opt-out work.
        await _stateStore.RemoveAsync(PendingUnsubscribeKey, ct);
        await SyncRegistrationAsync(ct);
        return PushEnableResult.Enabled;
    }

    private async Task<PushEnableResult> DisableAsync(CancellationToken ct)
    {
        _preferences.DailyPerekPushEnabled = false;
        try
        {
            await _platform.UnsubscribeFromTopicAsync(DailyPerekTopic, ct);
            await _stateStore.RemoveAsync(PendingUnsubscribeKey, ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a flaky unsubscribe must not fail a completed opt-out
        catch (Exception ex) //NOSONAR — opt-out already persisted; a flaky unsubscribe is retried later.
        {
            #pragma warning restore S2221
            // FCM keeps the topic subscription server-side; without the marker
            // the opted-out device would silently keep receiving notifications.
            try
            {
                await _stateStore.SetAsync(PendingUnsubscribeKey, DailyPerekTopic, ct);
            }
            #pragma warning disable S2221 // Deliberate failure boundary: marker persistence is best-effort — the opt-out is already recorded
            catch (Exception storeEx) //NOSONAR — marker persistence is best-effort; the opt-out is already recorded.
            {
                #pragma warning restore S2221
                Console.Error.WriteLine($"[Push] pending-unsubscribe persist failed: {storeEx.Message}");
            }
            Console.Error.WriteLine($"[Push] topic unsubscribe deferred: {ex.Message}");
        }
        await _stateStore.RemoveAsync(RegistrationFingerprintKey, ct);
        // A fresh service instance may not have resolved the identity yet —
        // the persisted user id still identifies the registered device row.
        var userId = _userId ?? await TryFetchAsync(() => _stateStore.GetAsync(UserIdKey, ct), "stored user id");
        if (userId is not null)
        {
            try
            {
                await _registry.UnregisterAsync(userId, ct);
            }
            #pragma warning disable S2221 // Deliberate failure boundary: unregister is best-effort after local opt-out
            catch (Exception ex) //NOSONAR — unregister is best-effort after local opt-out.
            {
                #pragma warning restore S2221
                Console.Error.WriteLine($"[Push] device unregister failed: {ex.Message}");
            }
        }
        return PushEnableResult.Disabled;
    }

    /// <summary>
    /// Re-applies the stored opt-in at startup: an enabled preference
    /// re-subscribes the topic (idempotent — covers reinstalls and token churn)
    /// and refreshes the device registration when anything rotated. Runs at
    /// most once per launch. A deferred opt-out
    /// (<see cref="PendingUnsubscribeKey"/>) is retried on every launch,
    /// including ones where the preference is already off.
    /// </summary>
    public async Task ApplyEnabledPreferenceAsync(CancellationToken ct)
    {
        if (!IsSupported)
        {
            return;
        }
        await FlushPendingUnsubscribeAsync(ct);
        if (_appliedThisLaunch || !_preferences.DailyPerekPushEnabled)
        {
            return;
        }
        try
        {
            await EnsureInitializedAsync(ct);
            var permission = await _platform.GetPermissionStateAsync(ct);
            if (permission != PushPermissionState.Granted)
            {
                // The preference records the user's intent; system revocation
                // is surfaced on the settings toggle instead of silently
                // dropping the opt-in.
                Console.WriteLine($"[Push] opt-in kept but permission is {permission}");
                return;
            }
            _appliedThisLaunch = true;
            await _platform.SubscribeToTopicAsync(DailyPerekTopic, ct);
            await _stateStore.RemoveAsync(PendingUnsubscribeKey, ct);
            await SyncRegistrationAsync(ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a startup apply failure is log-only — the opt-in persists
        catch (Exception ex) //NOSONAR — a startup apply failure is log-only; the opt-in persists.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] startup apply failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Retries a topic unsubscribe that failed during opt-out. FCM topic
    /// membership survives app storage, so the marker is only cleared after a
    /// confirmed unsubscribe; failures keep it for the next launch.
    /// </summary>
    private async Task FlushPendingUnsubscribeAsync(CancellationToken ct)
    {
        try
        {
            var pending = await _stateStore.GetAsync(PendingUnsubscribeKey, ct);
            if (pending is null)
            {
                return;
            }
            await _platform.UnsubscribeFromTopicAsync(pending, ct);
            await _stateStore.RemoveAsync(PendingUnsubscribeKey, ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: keep the marker — the retry happens on the next launch
        catch (Exception ex) //NOSONAR — keep the marker; the retry happens on the next launch.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] deferred unsubscribe retry failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Routes a tapped notification's data payload into app navigation. The
    /// contract carries <c>url</c> — a site-relative or absolute website URL;
    /// only perek/article links resolve, everything else is ignored.
    /// </summary>
    public void DispatchNotificationTap(IReadOnlyDictionary<string, string>? data)
    {
        if (ResolveTarget(data) is { } target)
        {
            AppLinkHelper.Request(target);
        }
    }

    /// <summary>Extracts the app-link target from a notification data payload.</summary>
    public static AppLinkHelper.AppLinkTarget? ResolveTarget(IReadOnlyDictionary<string, string>? data)
    {
        if (data is null || !data.TryGetValue(UrlDataKey, out var url))
        {
            return null;
        }
        if (!AppLinkHelper.TryResolveSiteUrl(url, out var siteUrl))
        {
            return null;
        }
        return AppLinkHelper.TryParse(siteUrl.AbsoluteUri, out var target) ? target : null;
    }

    /// <summary>
    /// One-time platform setup (notification channel, delegate wiring). Safe
    /// to call repeatedly — concurrent callers share the same attempt.
    /// </summary>
    public Task EnsureInitializedAsync(CancellationToken ct)
    {
        if (!IsSupported)
        {
            return Task.CompletedTask;
        }
        lock (_initLock)
        {
            _initializeTask ??= _platform.InitializeAsync(ct);
            return _initializeTask;
        }
    }

    /// <summary>
    /// Resolves and persists the durable notification identity, then POSTs the
    /// device-registration row — but only when the
    /// (user, installation, token, topics) tuple actually changed, so routine
    /// launches stay silent. Registration is best-effort: the contract
    /// endpoint is not deployed yet, so failures log and move on.
    /// </summary>
    private async Task SyncRegistrationAsync(CancellationToken ct)
    {
        await ResolveIdentityAsync(ct);
        if (_userId is null || _token is null)
        {
            return;
        }
        var fingerprint = $"{_userId}|{_installationId}|{_token}|{DailyPerekTopic}";
        if (await _stateStore.GetAsync(RegistrationFingerprintKey, ct) == fingerprint)
        {
            return;
        }
        try
        {
            await _registry.RegisterAsync(new PushDeviceRegistration(
                _userId,
                _installationId ?? string.Empty,
                _token,
                PlatformName(),
                [DailyPerekTopic],
                _appVersion()), ct);
            await _stateStore.SetAsync(RegistrationFingerprintKey, fingerprint, ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: the backend route is deferred — registration failure is log-only
        catch (Exception ex) //NOSONAR — the backend route is deferred; registration failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] device registration failed: {ex.Message}");
        }
    }

    private async Task ResolveIdentityAsync(CancellationToken ct)
    {
        _installationId ??= await TryFetchAsync(() => _platform.GetInstallationIdAsync(ct), "installation id");
        _token ??= await TryFetchAsync(() => _platform.GetTokenAsync(ct), "token");
        if (_userId is not null)
        {
            return;
        }
        var stored = await _stateStore.GetAsync(UserIdKey, ct);
        if (stored is null)
        {
            // FID is the designed user identity (no Advertising ID, per the
            // #1097 discussion); a GUID covers platforms where FID is absent.
            stored = _installationId ?? Guid.NewGuid().ToString("N");
            await _stateStore.SetAsync(UserIdKey, stored, ct);
        }
        _userId = stored;
    }

    private static async Task<string?> TryFetchAsync(Func<Task<string?>> fetch, string what)
    {
        try
        {
            return await fetch();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a fetch failure degrades identity fields, not the opt-in
        catch (Exception ex) //NOSONAR — a fetch failure degrades identity fields, not the opt-in.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] {what} fetch failed: {ex.Message}");
            return null;
        }
    }

#pragma warning disable S1172 // EventHandler signature requires sender.
    private void OnPlatformNotificationTapped(object? sender, IReadOnlyDictionary<string, string> data) =>
        DispatchNotificationTap(data);

    private void OnPlatformTokenRefreshed(object? sender, string token)
    {
        _token = token;
        if (!_preferences.DailyPerekPushEnabled)
        {
            return;
        }
        _tokenResync = ResyncAfterTokenRefreshAsync();
    }
#pragma warning restore S1172

    private async Task ResyncAfterTokenRefreshAsync()
    {
        try
        {
            await SyncRegistrationAsync(CancellationToken.None);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a resync failure is retried on the next registration trigger
        catch (Exception ex) //NOSONAR — a resync failure is retried on the next registration trigger.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] token-refresh resync failed: {ex.Message}");
        }
    }

#if ANDROID
    private static string PlatformName() => "android";
#elif IOS
    private static string PlatformName() => "ios";
#else
    private static string PlatformName() => "other";
#endif

    public void Dispose()
    {
        _platform.NotificationTapped -= OnPlatformNotificationTapped;
        _platform.TokenRefreshed -= OnPlatformTokenRefreshed;
    }

    private static PushNotificationService CreateDefault()
    {
        return new PushNotificationService(
            CreatePlatformClient(),
            PreferencesService.Instance,
            CreateStateStore(),
            CreateRegistry(),
#if MAUI
            () => AppInfo.Current.VersionString);
#else
            () => "unknown");
#endif
    }

    private static IPushPlatformClient CreatePlatformClient()
    {
#if ANDROID && !DISABLE_PUSH
        return new AndroidPushPlatformClient();
#elif IOS && !DISABLE_PUSH
        return new IosPushPlatformClient();
#else
        return NullPushPlatformClient.Instance;
#endif
    }

    private static IPushStateStore CreateStateStore()
    {
#if MAUI
        return new MauiPushStateStore();
#else
        return new InMemoryPushStateStore();
#endif
    }

    private static IPushDeviceRegistry CreateRegistry()
    {
#if MAUI
        return new HttpPushDeviceRegistry(() => AppConfig.Instance.GetWebsiteUrl());
#else
        return NullPushDeviceRegistry.Instance;
#endif
    }
}

/// <summary>No-op platform client for desktop platforms, tests and DISABLE_PUSH builds.</summary>
public sealed class NullPushPlatformClient : IPushPlatformClient
{
    public static readonly NullPushPlatformClient Instance = new();

    public bool IsSupported => false;
#pragma warning disable S1172 // Null object satisfies the interface contract; arguments unused.
    public Task InitializeAsync(CancellationToken ct) => Task.CompletedTask;
    public Task<PushPermissionState> GetPermissionStateAsync(CancellationToken ct) =>
        Task.FromResult(PushPermissionState.Unsupported);
    public Task<PushPermissionState> RequestPermissionAsync(CancellationToken ct) =>
        Task.FromResult(PushPermissionState.Unsupported);
    public Task<string?> GetTokenAsync(CancellationToken ct) => Task.FromResult<string?>(null);
    public Task<string?> GetInstallationIdAsync(CancellationToken ct) => Task.FromResult<string?>(null);
    public Task SubscribeToTopicAsync(string topic, CancellationToken ct) => Task.CompletedTask;
    public Task UnsubscribeFromTopicAsync(string topic, CancellationToken ct) => Task.CompletedTask;
#pragma warning restore S1172

    private EventHandler<IReadOnlyDictionary<string, string>>? _notificationTapped;
    private EventHandler<string>? _tokenRefreshed;

    // Explicit accessors keep the null client to the contract's shape — static
    // analysis cannot see the service subscribing through the interface and
    // flags plainly-declared events as unused.
    public event EventHandler<IReadOnlyDictionary<string, string>>? NotificationTapped
    {
        add => _notificationTapped += value;
        remove => _notificationTapped -= value;
    }
    public event EventHandler<string>? TokenRefreshed
    {
        add => _tokenRefreshed += value;
        remove => _tokenRefreshed -= value;
    }

    /// <summary>Test hook: raises <see cref="NotificationTapped"/>.</summary>
    public void RaiseTapped(IReadOnlyDictionary<string, string> data) =>
        _notificationTapped?.Invoke(this, data);

    /// <summary>Test hook: raises <see cref="TokenRefreshed"/>.</summary>
    public void RaiseTokenRefreshed(string token) =>
        _tokenRefreshed?.Invoke(this, token);
}

/// <summary>No-op registry for builds without a backend contract (non-MAUI hosts).</summary>
public sealed class NullPushDeviceRegistry : IPushDeviceRegistry
{
    public static readonly NullPushDeviceRegistry Instance = new();
#pragma warning disable S1172 // Null object satisfies the interface contract; arguments unused.
    public Task RegisterAsync(PushDeviceRegistration registration, CancellationToken ct) => Task.CompletedTask;
    public Task UnregisterAsync(string userId, CancellationToken ct) => Task.CompletedTask;
#pragma warning restore S1172
}

/// <summary>In-memory state store — non-MAUI fallback and unit tests.</summary>
public sealed class InMemoryPushStateStore : IPushStateStore
{
    private readonly Dictionary<string, string> _values = new();
#pragma warning disable S1172 // Interface contract keeps ct; the in-memory store is synchronous.
    public Task<string?> GetAsync(string key, CancellationToken ct) =>
        Task.FromResult(_values.TryGetValue(key, out var v) ? v : null);
    public Task SetAsync(string key, string value, CancellationToken ct)
    {
        _values[key] = value;
        return Task.CompletedTask;
    }
    public Task RemoveAsync(string key, CancellationToken ct)
    {
        _values.Remove(key);
        return Task.CompletedTask;
    }
#pragma warning restore S1172
}
