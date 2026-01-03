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
            return "http://10.0.2.2:3003/api/graphql";
#else
            return "http://localhost:3003/api/graphql";
#endif
        }
    }

    /// <summary>
    /// Gets the appropriate API URL based on build configuration.
    /// </summary>
    public string GetApiUrl()
    {
#if DEBUG
        return DevApiUrl;
#else
        return ApiUrl;
#endif
    }
}
