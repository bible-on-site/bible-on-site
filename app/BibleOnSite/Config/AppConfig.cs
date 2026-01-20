namespace BibleOnSite.Config;

/// <summary>
/// Application configuration singleton providing API endpoints and other settings.
/// </summary>
public sealed class AppConfig
{
    private static readonly Lazy<AppConfig> _instance = new(() => new AppConfig());

    public static AppConfig Instance => _instance.Value;

    private AppConfig() { }

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

    /// <summary>
    /// Gets the appropriate API URL based on build configuration.
    /// Can be overridden by setting the API_URL environment variable.
    /// </summary>
    public string GetApiUrl()
    {
        // Allow environment variable override for testing
        var envApiUrl = Environment.GetEnvironmentVariable("API_URL");
        if (!string.IsNullOrEmpty(envApiUrl))
        {
            // TODO: remove me - debug logging
            Console.WriteLine($"[DEBUG] GetApiUrl: Using API_URL env var: {envApiUrl}");
            return envApiUrl;
        }

#if DEBUG
        // TODO: remove me - debug logging
        Console.WriteLine($"[DEBUG] GetApiUrl: Using DevApiUrl (DEBUG build): {DevApiUrl}");
        return DevApiUrl;
#else
        // TODO: remove me - debug logging
        Console.WriteLine($"[DEBUG] GetApiUrl: Using ApiUrl (RELEASE build): {ApiUrl}");
        return ApiUrl;
#endif
    }
}
