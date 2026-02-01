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

        // Cached API URL override from build-time config
        private string? _apiUrlOverride;
        private bool _apiUrlOverrideLoaded;

        /// <summary>
        /// Gets API URL override from build-time config (api-config.txt).
        /// </summary>
        private async Task<string?> GetApiUrlOverrideAsync()
        {
                if (_apiUrlOverrideLoaded)
                        return _apiUrlOverride;

                try
                {
                        using var stream = await FileSystem.OpenAppPackageFileAsync("api-config.txt");
                        using var reader = new StreamReader(stream);
                        var content = await reader.ReadToEndAsync();
                        _apiUrlOverride = string.IsNullOrWhiteSpace(content) ? null : content.Trim();
                }
                catch
                {
                        _apiUrlOverride = null;
                }
                _apiUrlOverrideLoaded = true;
                return _apiUrlOverride;
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
                if (DeviceInfo.Current.DeviceType == DeviceType.Virtual)
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
