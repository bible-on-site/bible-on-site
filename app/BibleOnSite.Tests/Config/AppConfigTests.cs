using BibleOnSite.Config;
using FluentAssertions;

namespace BibleOnSite.Tests.Config;

public class AppConfigTests
{
    private static readonly object ApiUrlEnvLock = new();

    private static void WithApiUrl(string? value, Action action)
    {
        lock (ApiUrlEnvLock)
        {
            var previous = Environment.GetEnvironmentVariable("API_URL");
            try
            {
                Environment.SetEnvironmentVariable("API_URL", value);
                action();
            }
            finally
            {
                Environment.SetEnvironmentVariable("API_URL", previous);
            }
        }
    }

    public class RemoteHost
    {
        [Fact]
        public void returns_punycode_domain()
        {
            AppConfig.Instance.RemoteHost.Should().Be("xn--febl3a.com");
        }
    }

    public class ApiUrl
    {
        [Fact]
        public void returns_https_api_host()
        {
            AppConfig.Instance.ApiUrl.Should().Be("https://api.xn--febl3a.com");
        }
    }

    public class WebsiteUrl
    {
        [Fact]
        public void returns_https_website_host()
        {
            AppConfig.Instance.WebsiteUrl.Should().Be("https://xn--febl3a.com");
        }
    }

    public class DevApiUrl
    {
        [Fact]
        public void returns_localhost_port_3003_on_non_android()
        {
            AppConfig.Instance.DevApiUrl.Should().Be("http://localhost:3003");
        }
    }

    public class DevWebsiteUrl
    {
        [Fact]
        public void returns_localhost_port_3001_on_non_android()
        {
            AppConfig.Instance.DevWebsiteUrl.Should().Be("http://localhost:3001");
        }
    }

    public class TosUrl
    {
        [Fact]
        public void appends_tos_path_to_get_website_url()
        {
            var config = AppConfig.Instance;
            config.TosUrl.Should().Be($"{config.GetWebsiteUrl()}/tos");
        }

#if DEBUG
        [Fact]
        public void resolves_to_localhost_terms_url()
        {
            AppConfig.Instance.TosUrl.Should().Be("http://localhost:3001/tos");
        }
#endif
    }

    public class GetApiUrl
    {
        [Fact]
        public void returns_environment_value_when_api_url_is_set()
        {
            WithApiUrl("http://127.0.0.1:9999", () =>
            {
                AppConfig.Instance.GetApiUrl().Should().Be("http://127.0.0.1:9999");
            });
        }

        [Fact]
        public void returns_dev_api_url_when_api_url_is_unset_in_test_build()
        {
            WithApiUrl(null, () =>
            {
#if DEBUG
                AppConfig.Instance.GetApiUrl().Should().Be(AppConfig.Instance.DevApiUrl);
#else
                AppConfig.Instance.GetApiUrl().Should().Be(AppConfig.Instance.ApiUrl);
#endif
            });
        }

        [Fact]
        public void returns_dev_api_url_when_api_url_is_empty()
        {
            WithApiUrl("", () =>
            {
#if DEBUG
                AppConfig.Instance.GetApiUrl().Should().Be(AppConfig.Instance.DevApiUrl);
#else
                AppConfig.Instance.GetApiUrl().Should().Be(AppConfig.Instance.ApiUrl);
#endif
            });
        }
    }
}
