namespace BibleOnSite.Services;

/// <summary>
/// Monitors network connectivity and triggers background refresh of cached data
/// when the device comes back online.
/// </summary>
public class NetworkService : IDisposable
{
    private static readonly Lazy<NetworkService> _instance = new(() => new NetworkService());
    public static NetworkService Instance => _instance.Value;

    private bool _wasOffline;
    private bool _disposed;

    private NetworkService()
    {
        // Seed the initial state
        _wasOffline = Connectivity.Current.NetworkAccess != NetworkAccess.Internet;
    }

    /// <summary>
    /// Whether the device currently has internet access.
    /// </summary>
    public static bool IsOnline =>
        Connectivity.Current.NetworkAccess == NetworkAccess.Internet;

    /// <summary>
    /// Starts listening for connectivity changes.
    /// Call once from App startup (after LoadingPage navigates).
    /// </summary>
    public void StartMonitoring()
    {
        Connectivity.Current.ConnectivityChanged += OnConnectivityChanged;
        Console.WriteLine($"[Network] Monitoring started. Online={IsOnline}");
    }

    /// <summary>
    /// Stops listening for connectivity changes.
    /// </summary>
    public void StopMonitoring()
    {
        Connectivity.Current.ConnectivityChanged -= OnConnectivityChanged;
    }

    private async void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        var isNowOnline = e.NetworkAccess == NetworkAccess.Internet;
        Console.WriteLine($"[Network] Connectivity changed: {e.NetworkAccess} (online={isNowOnline})");

        if (isNowOnline && _wasOffline)
        {
            Console.WriteLine("[Network] Back online — refreshing starter data");
            // Refresh starter data in background so article counts etc. become available
            await StarterService.Instance.TryRefreshAsync();
        }

        _wasOffline = !isNowOnline;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopMonitoring();
    }
}
