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
    /// In DEBUG mode, uses DevApiUrl only on emulators (real devices use production API).
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
        // Only use DevApiUrl on emulators/simulators - real devices should use production API
        // because 10.0.2.2 (Android) or localhost is not accessible from real devices
#if MAUI
        if (DeviceInfo.Current.DeviceType == DeviceType.Virtual)
        {
            // TODO: remove me - debug logging
            Console.WriteLine($"[DEBUG] GetApiUrl: Using DevApiUrl (DEBUG + emulator): {DevApiUrl}");
            return DevApiUrl;
        }
        else
        {
            // TODO: remove me - debug logging
            Console.WriteLine($"[DEBUG] GetApiUrl: Using ApiUrl (DEBUG + real device): {ApiUrl}");
            return ApiUrl;
        }
#else
        // Non-MAUI builds (tests) - use DevApiUrl in DEBUG mode
        return DevApiUrl;
#endif
#else
        // TODO: remove me - debug logging
        Console.WriteLine($"[DEBUG] GetApiUrl: Using ApiUrl (RELEASE build): {ApiUrl}");
        return ApiUrl;
#endif
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
}
