using System.Net;
using System.Text;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosAppInstallationTests
{
    private const string Nonce = "50a16675077e44749d1e4eb503c1ea67";
    private static MobileTestConfiguration Configuration => new(MobilePlatform.IOS, "/test/BibleOnSite.app",
        "4AD2086B-7B8F-4608-A742-AA422A0B8D74", "/test/artifacts", new("http://localhost:4723"))
    { PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app" };

    private static Dictionary<string, object> Receipt() => new()
    {
        ["kind"] = "ios-verified-install/1", ["udid"] = Configuration.DeviceId,
        ["appPath"] = Configuration.AppPath, ["nonce"] = Nonce,
        ["bundleId"] = "com.tanah.daily929", ["bundleSha256"] = new string('a', 64), ["keepData"] = false,
        ["observerAcknowledged"] = true
    };

    [Fact]
    public void ExactCurrentReceiptEnablesBundleOnlyCapabilitiesWithoutRepeatingInstallOrScrub()
    {
        var proof = IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(Receipt()), Configuration, Nonce);
        var options = new IosPlatformAdapter().CreateOptions(Configuration with { VerifiedIosApp = proof }).ToDictionary();
        Assert.False(options.ContainsKey("appium:app"));
        Assert.False(options.ContainsKey("appium:enforceAppInstall"));
        Assert.Equal("com.tanah.daily929", options["appium:bundleId"]);
        Assert.Equal(true, options["appium:noReset"]);
        Assert.Equal(false, options["appium:fullReset"]);
        Assert.Equal(true, options["appium:forceAppLaunch"]);
        Assert.Equal(180000, options["appium:wdaLaunchTimeout"]);
    }

    [Theory]
    [InlineData("kind", "ios-verified-install/0")]
    [InlineData("nonce", "00000000000000000000000000000000")]
    [InlineData("udid", "different-device")]
    [InlineData("appPath", "/another/BibleOnSite.app")]
    [InlineData("bundleId", "com.other.app")]
    [InlineData("bundleSha256", "not-a-hash")]
    public void RefusesStaleOrMismatchedInstallationReceipts(string field, string value)
    {
        var receipt = Receipt();
        receipt[field] = value;
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
    }

    [Fact]
    public void ReaderAcknowledgementMustBePresentAndTrueBeforeDriverCapabilities()
    {
        var receipt = Receipt();
        receipt.Remove("observerAcknowledged");
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
        receipt["observerAcknowledged"] = false;
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
    }

    [Fact]
    public void ReceiptCannotSubstituteReviewRetentionForNormalFreshData()
    {
        var receipt = Receipt();
        receipt["keepData"] = true;
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
    }

    [Fact]
    public void ProofCannotBeReusedForAnotherDeviceWhenBuildingCapabilities()
    {
        var proof = IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(Receipt()), Configuration, Nonce);
        Assert.Throws<InvalidOperationException>(() => new IosPlatformAdapter().CreateOptions(
            Configuration with { DeviceId = "another-device", VerifiedIosApp = proof }));
    }

    [Fact]
    public void AnInheritedPreinstalledFlagAloneCannotSkipIosInstallation()
    {
        var options = new IosPlatformAdapter().CreateOptions(Configuration with { AppPreinstalled = true }).ToDictionary();
        Assert.Equal(Configuration.AppPath, options["appium:app"]);
        Assert.Equal(false, options["appium:noReset"]);
        Assert.Equal(true, options["appium:enforceAppInstall"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ParentRequestContainsOnlyFiniteIdentityAndPreservesTheOriginalBudget(bool keepData)
    {
        WithArtifacts(configuration =>
        {
            configuration = configuration with { KeepAppForReview = keepData };
            var calls = 0;
            var handler = new Handler(async (request, cancellation) =>
            {
                calls++;
                Assert.Equal("http", request.RequestUri!.Scheme);
                Assert.Equal("127.0.0.1", request.RequestUri.Host);
                Assert.Equal(47255, request.RequestUri.Port);
                Assert.Equal("/prepare", request.RequestUri.AbsolutePath);
                Assert.Equal(new string('a', 64), request.Headers.Authorization!.Parameter);
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellation));
                Assert.Equal(["deadlineMs", "keepData", "kind", "nonce", "phase", "udid"],
                    body.RootElement.EnumerateObject().Select(property => property.Name).Order());
                var value = body.RootElement;
                Assert.Equal("ios-install-request/1", value.GetProperty("kind").GetString());
                Assert.Equal("install", value.GetProperty("phase").GetString());
                Assert.Equal(configuration.DeviceId, value.GetProperty("udid").GetString());
                Assert.Equal(keepData, value.GetProperty("keepData").GetBoolean());
                var remaining = value.GetProperty("deadlineMs").GetInt64() - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                Assert.InRange(remaining, 1, 300000);
                Assert.Equal(value.GetProperty("deadlineMs").GetInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
                    Assert.Single(request.Headers.GetValues("X-Ios-Preparation-Deadline")));
                var receipt = Receipt();
                receipt["nonce"] = value.GetProperty("nonce").GetString()!;
                receipt["keepData"] = keepData;
                return Response(HttpStatusCode.OK, receipt);
            });
            var proof = IosAppInstallation.Prepare(configuration, TimeSpan.FromMinutes(5), Environment,
                remaining =>
                {
                    Assert.InRange(remaining.TotalMilliseconds, 1, 300000);
                    return new HttpClient(handler) { Timeout = remaining };
                });
            Assert.True(Guid.TryParseExact(proof.Nonce, "N", out _));
            Assert.Equal(1, calls);
            Assert.True(File.Exists(Path.Combine(configuration.ArtifactDirectory, "ios-installations.jsonl")));
        });
    }

    [Theory]
    [InlineData("http://remote.example/", null)]
    [InlineData("0", null)]
    [InlineData("65536", null)]
    [InlineData("+47255", null)]
    [InlineData("47255/path", null)]
    [InlineData("47255", "short")]
    public void InvalidObserverCannotChooseADestinationOrStartARequest(string port, string? token)
    {
        Assert.Throws<InvalidOperationException>(() => IosAppInstallation.Prepare(Configuration,
            TimeSpan.FromMinutes(5), key => key == "MOBILE_IOS_PREPARATION_PORT" ? port : token ?? new string('a', 64),
            _ => throw new InvalidOperationException("A client must not be constructed.")));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(301)]
    public void ParentRequestRejectsMissingOrExpandedStartupAllowance(int seconds) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => IosAppInstallation.Prepare(Configuration,
            TimeSpan.FromSeconds(seconds), Environment, _ => throw new InvalidOperationException("Must not construct a client.")));

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Redirect)]
    public void ParentFailureOrRedirectCannotBecomeAnInstallationReceipt(HttpStatusCode status)
    {
        WithArtifacts(configuration => Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.Prepare(configuration, TimeSpan.FromMinutes(5), Environment,
                remaining => new HttpClient(new Handler((_, _) => Task.FromResult(Response(status, Receipt())))) { Timeout = remaining })));
    }

    [Fact]
    public void RequestCancellationUsesTheOriginalDeadlineWithoutAProcessTreeWalk()
    {
        WithArtifacts(configuration =>
        {
            var entered = false;
            var handler = new Handler(async (_, cancellation) =>
            {
                entered = true;
                await Task.Delay(Timeout.Infinite, cancellation);
                throw new InvalidOperationException("A cancelled request must not produce a receipt.");
            });
            Assert.Throws<TimeoutException>(() => IosAppInstallation.Prepare(configuration,
                TimeSpan.FromMilliseconds(250), Environment, remaining => new HttpClient(handler) { Timeout = remaining }));
            Assert.True(entered);
        });
    }

    private static string? Environment(string name) => name == "MOBILE_IOS_PREPARATION_PORT" ? "47255" : new string('a', 64);
    private static HttpResponseMessage Response(HttpStatusCode status, Dictionary<string, object> body) => new(status)
    { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static void WithArtifacts(Action<MobileTestConfiguration> action)
    {
        var directory = Path.Combine(Path.GetTempPath(), "ios-install-client-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try { action(Configuration with { ArtifactDirectory = directory }); }
        finally { Directory.Delete(directory, recursive: true); }
    }

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            send(request, cancellationToken);
    }
}
