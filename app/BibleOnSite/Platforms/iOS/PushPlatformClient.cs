using Firebase.Installations;
using Plugin.Firebase.CloudMessaging;
using Plugin.Firebase.CloudMessaging.EventArgs;
using UserNotifications;

namespace BibleOnSite.Services;

/// <summary>
/// iOS push client (#1097) over Plugin.Firebase.CloudMessaging: UNUserNotification
/// authorization, APNs registration, topic subscription and FCM token/FID
/// capture. The plugin's shared delegates (installed once by
/// <see cref="PlatformInitialize"/>) raise <see cref="NotificationTapped"/> for
/// both cold and warm notification taps — including the missed-tap queue it
/// replays when the first subscriber attaches.
/// </summary>
internal sealed class IosPushPlatformClient : IPushPlatformClient
{
    public bool IsSupported => true;

    /// <summary>
    /// Installs the UNUserNotificationCenter/FIRMessaging delegates and kicks
    /// the silent APNs device-token registration at launch
    /// (WillFinishLaunching). The user-facing authorization prompt stays
    /// behind the opt-in flow — APNs registration itself shows no prompt.
    /// Firebase must already be initialized.
    /// </summary>
    public static void PlatformInitialize()
    {
        FirebaseCloudMessagingImplementation.Initialize();
    }

#pragma warning disable S1172 // Interface contract keeps ct; the plugin wiring is synchronous.
    public Task InitializeAsync(CancellationToken ct)
    {
        var messaging = CrossFirebaseCloudMessaging.Current;
        messaging.NotificationTapped += OnNotificationTapped;
        messaging.TokenChanged += OnTokenChanged;
        messaging.Error += OnError;
        return Task.CompletedTask;
    }
#pragma warning restore S1172

    public async Task<PushPermissionState> GetPermissionStateAsync(CancellationToken ct)
    {
        var settings = await UNUserNotificationCenter.Current.GetNotificationSettingsAsync().WaitAsync(ct);
        return settings.AuthorizationStatus switch
        {
            UNAuthorizationStatus.Authorized or
            UNAuthorizationStatus.Provisional or
            UNAuthorizationStatus.Ephemeral => PushPermissionState.Granted,
            UNAuthorizationStatus.Denied => PushPermissionState.Denied,
            _ => PushPermissionState.NotDetermined,
        };
    }

    public async Task<PushPermissionState> RequestPermissionAsync(CancellationToken ct)
    {
        var (granted, _) = await UNUserNotificationCenter.Current.RequestAuthorizationAsync(
            UNAuthorizationOptions.Alert | UNAuthorizationOptions.Badge | UNAuthorizationOptions.Sound)
            .WaitAsync(ct);
        return granted ? PushPermissionState.Granted : PushPermissionState.Denied;
    }

    public async Task<string?> GetTokenAsync(CancellationToken ct)
    {
        try
        {
            return await CrossFirebaseCloudMessaging.Current.GetTokenAsync().WaitAsync(ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a token fetch failure degrades diagnostics, not push delivery
        catch (Exception ex) //NOSONAR — a token fetch failure degrades diagnostics, not push delivery.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] FCM token fetch failed: {ex.Message}");
            return null;
        }
    }

    public async Task<string?> GetInstallationIdAsync(CancellationToken ct)
    {
        try
        {
            return await Installations.DefaultInstance.GetInstallationIdAsync().WaitAsync(ct);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: an FID fetch failure falls back to the GUID identity
        catch (Exception ex) //NOSONAR — an FID fetch failure falls back to the GUID identity.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] installation id fetch failed: {ex.Message}");
            return null;
        }
    }

    public Task SubscribeToTopicAsync(string topic, CancellationToken ct) =>
        CrossFirebaseCloudMessaging.Current.SubscribeToTopicAsync(topic).WaitAsync(ct);

    public Task UnsubscribeFromTopicAsync(string topic, CancellationToken ct) =>
        CrossFirebaseCloudMessaging.Current.UnsubscribeFromTopicAsync(topic).WaitAsync(ct);

    private EventHandler<IReadOnlyDictionary<string, string>>? _notificationTapped;
    private EventHandler<string>? _tokenRefreshed;

    // Explicit accessors keep the client to the contract's shape — static
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

#pragma warning disable S1172 // EventHandler signature requires sender.
    private void OnNotificationTapped(object? sender, FCMNotificationTappedEventArgs e) =>
        _notificationTapped?.Invoke(this,
            e.Notification.Data is { } data
                ? new Dictionary<string, string>(data)
                : new Dictionary<string, string>());

    private void OnTokenChanged(object? sender, FCMTokenChangedEventArgs e) =>
        _tokenRefreshed?.Invoke(this, e.Token);

    private void OnError(object? sender, FCMErrorEventArgs e) =>
        Console.Error.WriteLine($"[Push] {e.Message}");
#pragma warning restore S1172
}
