#if MAUI
using Microsoft.Maui.Devices;
#endif

namespace BibleOnSite.Config;

/// <summary>
/// Application configuration singleton providing API endpoints and other settings.
/// </summary>
public sealed class AppConfig
{
    private static readonly Lazy<AppConfig> _instance = new(() => new AppConfig());

    public static AppConfig Instance => _instance.Value;

    private readonly IFileSystem _fileSystem;
    private readonly IDeviceInfo _deviceInfo;

    private AppConfig() : this(FileSystem.Current, DeviceInfo.Current) { }

    public AppConfig(IFileSystem fileSystem, IDeviceInfo deviceInfo)
    {
        _fileSystem = fileSystem;
        _deviceInfo = deviceInfo;
    }

    /// <summary>
    /// The remote API host domain.
    /// </summary>
    public string RemoteHost { get; } = "xn--febl3a.com";

    /// <summary>
    /// The full GraphQL API URL.
    /// </summary>
    public string ApiUrl => $"https://api.{RemoteHost}";

    /// <summary>
    /// Development API URL for local testing (Android emulator uses 10.0.2.2 for host loopback).
    /// </summary>
    public string DevApiUrl
    {
        get
        {
#if ANDROID
            return "http://10.0.2.2:3003";
#else
            return "http://localhost:3003";
#endif
        }
    }

    // Cached API URL override from build-time config
    private string? _apiUrlOverride;
    private bool _apiUrlOverrideLoaded;

    /// <summary>
    /// Gets API URL override from build-time config (api-config.txt).
    /// </summary>
    private async Task<string?> GetApiUrlOverrideAsync()
    {
        if (_apiUrlOverrideLoaded)
        {
            return _apiUrlOverride;
        }

        _apiUrlOverride = await ReadPackagedValueAsync("api-config.txt");
        _apiUrlOverrideLoaded = true;
        return _apiUrlOverride;
    }

    // Cached Mapbox public token from build-time config
    private string? _mapboxToken;
    private bool _mapboxTokenLoaded;

    /// <summary>
    /// The Mapbox public token for the places map - packaged by CI as
    /// mapbox-token.txt (the public key the website embeds in client bundles).
    /// Null without a packaged/env token; callers then keep the no-key
    /// OpenStreetMap fallback, same as the website.
    /// </summary>
    public async Task<string?> GetMapboxAccessTokenAsync()
    {
        var envToken = Environment.GetEnvironmentVariable("MAPBOX_ACCESS_TOKEN");
        if (!string.IsNullOrEmpty(envToken))
        {
            return envToken;
        }

        if (!_mapboxTokenLoaded)
        {
            _mapboxToken = await ReadPackagedValueAsync("mapbox-token.txt");
            _mapboxTokenLoaded = true;
        }
        return _mapboxToken;
    }

    /// <summary>Reads a trimmed packaged raw-asset value; null when missing/blank.</summary>
    private async Task<string?> ReadPackagedValueAsync(string assetName)
    {
        try
        {
            using var stream = await _fileSystem.OpenAppPackageFileAsync(assetName);
            using var reader = new StreamReader(stream);
            var content = await reader.ReadToEndAsync();
            return string.IsNullOrWhiteSpace(content) ? null : content.Trim();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: packaged-config probe degrades to a null fallback
        catch (Exception ex) //NOSONAR — packaged-config probe degrades to a null fallback.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Packaged config '{assetName}' unreadable: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Gets the appropriate API URL based on build configuration.
    /// Priority: 1) Build-time override (api-config.txt), 2) Environment variable, 3) Default based on build config.
    /// In DEBUG mode, uses DevApiUrl only on emulators (real devices use production API).
    /// </summary>
    public string GetApiUrl()
    {
        // Check build-time override first (synchronous check of cached value)
        if (_apiUrlOverrideLoaded && !string.IsNullOrEmpty(_apiUrlOverride))
        {
            return _apiUrlOverride;
        }

        // Allow environment variable override for testing (works on Windows/desktop)
        var envApiUrl = Environment.GetEnvironmentVariable("API_URL");
        if (!string.IsNullOrEmpty(envApiUrl))
        {
            return envApiUrl;
        }

#if DEBUG
        // Only use DevApiUrl on emulators/simulators - real devices should use production API
        // because 10.0.2.2 (Android) or localhost is not accessible from real devices
#if MAUI
        if (_deviceInfo.DeviceType == DeviceType.Virtual)
        {
            return DevApiUrl;
        }
        else
        {
            return ApiUrl;
        }
#else
        // Non-MAUI (e.g., unit tests) - use DevApiUrl in debug mode
        return DevApiUrl;
#endif
#else
        return ApiUrl;
#endif
    }

    /// <summary>
    /// Initializes async config values. Call during app startup.
    /// </summary>
    public async Task InitializeAsync()
    {
        await GetApiUrlOverrideAsync();
        await GetMapboxAccessTokenAsync();
    }

    /// <summary>
    /// Development website URL for local testing (Android emulator uses 10.0.2.2 for host loopback).
    /// </summary>
    public string DevWebsiteUrl
    {
        get
        {
#if ANDROID
            return "http://10.0.2.2:3001";
#else
            return "http://localhost:3001";
#endif
        }
    }

    /// <summary>
    /// The production website URL.
    /// </summary>
    public string WebsiteUrl => $"https://{RemoteHost}";

    /// <summary>
    /// Gets the appropriate website URL based on build configuration.
    /// </summary>
    public string GetWebsiteUrl()
    {
#if DEBUG
        return DevWebsiteUrl;
#else
        return WebsiteUrl;
#endif
    }

    /// <summary>
    /// Gets the Terms of Service URL.
    /// </summary>
    public string TosUrl => $"{GetWebsiteUrl()}/tos";

    /// <summary>
    /// Gets the accessibility statement URL. The statement itself is
    /// maintained on the website so app and site never drift apart.
    /// </summary>
    public string AccessibilityUrl => $"{GetWebsiteUrl()}/accessibility";
}
