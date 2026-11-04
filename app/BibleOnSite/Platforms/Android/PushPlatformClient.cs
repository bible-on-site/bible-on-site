using Android.App;
using Android.Content;
using Android.Gms.Extensions;
using Firebase.Installations;
using Plugin.Firebase.CloudMessaging;
using Plugin.Firebase.CloudMessaging.EventArgs;

namespace BibleOnSite.Services;

/// <summary>
/// Android push client (#1097) over Plugin.Firebase.CloudMessaging: topic
/// subscription, the Android 13+ runtime permission, the daily-perek
/// notification channel and FCM token/FID capture. Notification taps reach it
/// two ways — foreground receipts the plugin reposts as a local notification
/// with its own extra, and system-tray deliveries whose launch intent carries
/// <c>google.message_id</c> — both are decoded by
/// <see cref="FirebaseCloudMessagingImplementation.OnNewIntent"/>.
/// </summary>
internal sealed class AndroidPushPlatformClient : IPushPlatformClient
{
    /// <summary>Channel id — must match the manifest's
    /// com.google.firebase.messaging.default_notification_channel_id.</summary>
    internal static string ChannelId => PushNotificationService.DailyPerekTopic;

    public bool IsSupported => true;

#pragma warning disable S1172 // Interface contract keeps ct; plugin/permission calls take no token.
    public async Task InitializeAsync(CancellationToken ct)
    {
        FirebaseCloudMessagingImplementation.ChannelId = ChannelId;
        FirebaseCloudMessagingImplementation.SmallIconRef = Resource.Mipmap.appicon;
        var messaging = CrossFirebaseCloudMessaging.Current;
        messaging.NotificationTapped += OnNotificationTapped;
        messaging.TokenChanged += OnTokenChanged;
        messaging.Error += OnError;
        CreateNotificationChannel();
        try
        {
            // Play-services check + token warm-up; a valid install raises
            // TokenChanged through OnNewToken/OnTokenRefreshAsync.
            await messaging.CheckIfValidAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a missing Play-services install degrades push, not the app
        catch (Exception ex) //NOSONAR — a missing Play-services install degrades push, not the app.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] validity check failed: {ex.Message}");
        }
    }

    private static void CreateNotificationChannel()
    {
        if (!OperatingSystem.IsAndroidVersionAtLeast(26))
        {
            return;
        }
        var manager = (NotificationManager?)Android.App.Application.Context.GetSystemService(Context.NotificationService);
        if (manager?.GetNotificationChannel(ChannelId) is not null)
        {
            return;
        }
        var channel = new NotificationChannel(ChannelId, "הפרק היומי", NotificationImportance.Default)
        {
            Description = "התראה על פרק התנ\"ך היומי",
        };
        manager?.CreateNotificationChannel(channel);
    }

    public async Task<PushPermissionState> GetPermissionStateAsync(CancellationToken ct)
    {
        // Effective delivery is narrower than the runtime permission: the
        // app-level notifications toggle (any API level) and, on O+, the
        // daily-perek channel's importance can each silence pushes on their
        // own. AreNotificationsEnabled covers the runtime grant on 33+ as
        // well as settings blocks, but cannot distinguish never-asked from
        // denied — report NotDetermined and let RequestPermissionAsync
        // settle it.
        var manager = (NotificationManager?)Android.App.Application.Context.GetSystemService(Context.NotificationService);
        if (OperatingSystem.IsAndroidVersionAtLeast(24) && manager?.AreNotificationsEnabled() == false)
        {
            return OperatingSystem.IsAndroidVersionAtLeast(33)
                ? PushPermissionState.NotDetermined
                : PushPermissionState.Denied;
        }
        if (OperatingSystem.IsAndroidVersionAtLeast(26)
            && manager?.GetNotificationChannel(ChannelId) is { Importance: NotificationImportance.None })
        {
            // The user blocked the channel in system settings — only the
            // settings dialog (PermissionDenied path) can undo that.
            return PushPermissionState.Denied;
        }
        if (!OperatingSystem.IsAndroidVersionAtLeast(33))
        {
            return PushPermissionState.Granted;
        }
        var status = await Permissions.CheckStatusAsync<Permissions.PostNotifications>();
        return status == PermissionStatus.Granted
            ? PushPermissionState.Granted
            : PushPermissionState.NotDetermined;
    }

    public async Task<PushPermissionState> RequestPermissionAsync(CancellationToken ct)
    {
        if (!OperatingSystem.IsAndroidVersionAtLeast(33))
        {
            return PushPermissionState.Granted;
        }
        var status = await Permissions.RequestAsync<Permissions.PostNotifications>();
        return status == PermissionStatus.Granted
            ? PushPermissionState.Granted
            : PushPermissionState.Denied;
    }
#pragma warning restore S1172

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
            var id = await FirebaseInstallations.Instance.GetId().AsAsync<Java.Lang.String>().WaitAsync(ct);
            return id?.ToString();
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

    /// <summary>
    /// Entry point for notification-tap launch intents from MainActivity
    /// (OnCreate and OnNewIntent). The plugin decodes both its own reposted
    /// local notifications and system-tray FCM deliveries, raising
    /// <see cref="IPushPlatformClient.NotificationTapped"/> with the data
    /// payload; VIEW-intent app links are ignored (handled elsewhere).
    /// </summary>
    public static async Task HandleLaunchIntentAsync(Intent? intent)
    {
        if (intent is null || intent.Action == Intent.ActionView)
        {
            return;
        }
        try
        {
            // Ensures the service + event wiring exist before the plugin
            // dispatches the tap — the queued-notification path depends on a
            // subscriber being attached.
            await PushNotificationService.Instance.EnsureInitializedAsync(CancellationToken.None);
            FirebaseCloudMessagingImplementation.OnNewIntent(intent);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a malformed launch intent is log-only
        catch (Exception ex) //NOSONAR — a malformed launch intent is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Push] intent handling failed: {ex.Message}");
        }
    }
}
