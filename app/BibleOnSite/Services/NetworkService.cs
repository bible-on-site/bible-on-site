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
    private bool _monitoring;
    private readonly IConnectivity _connectivity;
    private readonly Func<Task> _refresh;

    private NetworkService() : this(Connectivity.Current, () => StarterService.Instance.TryRefreshAsync()) { }

    public NetworkService(IConnectivity connectivity, Func<Task> refresh)
    {
        _connectivity = connectivity;
        _refresh = refresh;
        // Seed the initial state
        _wasOffline = _connectivity.NetworkAccess != NetworkAccess.Internet;
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
        if (_disposed || _monitoring)
        {
            return;
        }
        _monitoring = true;
        _connectivity.ConnectivityChanged += OnConnectivityChanged;
        Console.WriteLine($"[Network] Monitoring started. Online={_connectivity.NetworkAccess == NetworkAccess.Internet}");
    }

    /// <summary>
    /// Stops listening for connectivity changes.
    /// </summary>
    public void StopMonitoring()
    {
        _connectivity.ConnectivityChanged -= OnConnectivityChanged;
        _monitoring = false;
    }

    private async void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
    {
        var isNowOnline = e.NetworkAccess == NetworkAccess.Internet;
        Console.WriteLine($"[Network] Connectivity changed: {e.NetworkAccess} (online={isNowOnline})");

        var shouldRefresh = isNowOnline && _wasOffline;
        // Record the transition before awaiting; duplicate notifications during a
        // refresh must not start more requests for the same offline period.
        _wasOffline = !isNowOnline;
        if (shouldRefresh)
        {
            Console.WriteLine("[Network] Back online — refreshing starter data");
            // Refresh starter data in background so article counts etc. become available
            try
            {
                await _refresh();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[Network] Refresh failed: {ex.Message}");
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopMonitoring();
    }
}
