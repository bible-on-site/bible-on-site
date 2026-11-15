using System.Net;
using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class ReaderStartupReadinessTests
{
    private const string LaunchId = "7cc4c496-4e24-478c-93eb-d62e9ec0077c";

    [Fact]
    public void LaunchIdentityIsFreshAndCanonical()
    {
        var first = ReaderStartupReadiness.CreateLaunchId();
        Assert.Equal(Guid.ParseExact(first, "D").ToString("D"), first);
        Assert.NotEqual(first, ReaderStartupReadiness.CreateLaunchId());
    }

    [Theory]
    [InlineData("")]
    [InlineData("7cc4c4964e24478c93ebd62e9ec0077c")]
    [InlineData("7CC4C496-4E24-478C-93EB-D62E9EC0077C")]
    public void RejectsNoncanonicalIdentityWithoutPolling(string launchId)
    {
        Assert.Throws<ArgumentException>(() => ReaderStartupReadiness.WaitForReady(launchId,
            TimeSpan.FromSeconds(45), _ => throw new InvalidOperationException(),
            () => TimeSpan.Zero, _ => throw new InvalidOperationException()));
    }

    [Fact]
    public void MatchingReadyResponseReturnsTheUnspentTitleBudgetWithoutPausing()
    {
        var clock = new FakeClock();
        var remaining = ReaderStartupReadiness.WaitForReady(LaunchId, TimeSpan.FromSeconds(45), timeout =>
        {
            Assert.Equal(TimeSpan.FromSeconds(10), timeout);
            clock.Advance(TimeSpan.FromSeconds(4));
            return ReadyResponse();
        }, () => clock.Elapsed, clock.Pause);

        Assert.Equal(TimeSpan.FromSeconds(41), remaining);
        Assert.Empty(clock.Pauses);
    }

    [Theory]
    [InlineData("{\"ok\":true,\"ready\":true,\"launchId\":null}")]
    [InlineData("{\"ok\":true,\"ready\":true,\"launchId\":\"c200c69f-6a75-4736-9bb6-e9b9670315ba\"}")]
    [InlineData("{\"ok\":true,\"ready\":false,\"launchId\":\"7cc4c496-4e24-478c-93eb-d62e9ec0077c\"}")]
    [InlineData("{\"ok\":false,\"ready\":true,\"launchId\":\"7cc4c496-4e24-478c-93eb-d62e9ec0077c\"}")]
    [InlineData("{\"ok\":true}")]
    [InlineData("[]")]
    [InlineData("not json")]
    public void WaitsPastStaleUnreadyAndMalformedResponses(string firstResponse)
    {
        var clock = new FakeClock();
        var reads = 0;
        var remaining = ReaderStartupReadiness.WaitForReady(LaunchId, TimeSpan.FromSeconds(45), _ =>
        {
            clock.Advance(TimeSpan.FromSeconds(2));
            return ++reads == 1 ? firstResponse : ReadyResponse();
        }, () => clock.Elapsed, clock.Pause);

        Assert.Equal(2, reads);
        Assert.Equal(TimeSpan.FromMilliseconds(40800), remaining);
        Assert.Equal(TimeSpan.FromMilliseconds(200), Assert.Single(clock.Pauses));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void TransientHttpFailureConsumesTheSameBudget(bool canceled)
    {
        var clock = new FakeClock();
        var reads = 0;
        var remaining = ReaderStartupReadiness.WaitForReady(LaunchId, TimeSpan.FromSeconds(45), _ =>
        {
            clock.Advance(TimeSpan.FromSeconds(3));
            if (++reads == 1)
            {
                throw canceled ? new OperationCanceledException() : new HttpRequestException();
            }
            return ReadyResponse();
        }, () => clock.Elapsed, clock.Pause);

        Assert.Equal(TimeSpan.FromMilliseconds(38800), remaining);
        Assert.Equal(2, reads);
    }

    [Fact]
    public void RequestsAndPausesAreClampedToTheExistingBudget()
    {
        var clock = new FakeClock();
        var timeouts = new List<TimeSpan>();
        var exception = Assert.Throws<WebDriverTimeoutException>(() => ReaderStartupReadiness.WaitForReady(
            LaunchId, TimeSpan.FromMilliseconds(450), timeout =>
            {
                timeouts.Add(timeout);
                clock.Advance(TimeSpan.FromMilliseconds(100));
                return "{}";
            }, () => clock.Elapsed, clock.Pause));

        Assert.Equal([TimeSpan.FromMilliseconds(450), TimeSpan.FromMilliseconds(150)], timeouts);
        Assert.Equal([TimeSpan.FromMilliseconds(200), TimeSpan.FromMilliseconds(50)], clock.Pauses);
        Assert.Equal(TimeSpan.FromMilliseconds(450), clock.Elapsed);
        Assert.Contains("did not settle", exception.Message);
    }

    [Fact]
    public void AReadyResponseAtTheDeadlineDoesNotRestartTheBudget()
    {
        var clock = new FakeClock();
        var reads = 0;
        Assert.Throws<WebDriverTimeoutException>(() => ReaderStartupReadiness.WaitForReady(
            LaunchId, TimeSpan.FromSeconds(45), timeout =>
            {
                Assert.Equal(TimeSpan.FromSeconds(10), timeout);
                reads++;
                clock.Advance(TimeSpan.FromSeconds(45));
                return ReadyResponse();
            }, () => clock.Elapsed, clock.Pause));
        Assert.Equal(1, reads);
        Assert.Empty(clock.Pauses);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void ExhaustedBudgetNeverQueriesTheEndpoint(int milliseconds)
    {
        Assert.Throws<WebDriverTimeoutException>(() => ReaderStartupReadiness.WaitForReady(LaunchId,
            TimeSpan.FromMilliseconds(milliseconds), _ => throw new InvalidOperationException(),
            () => TimeSpan.Zero, _ => throw new InvalidOperationException()));
    }

    [Fact]
    public void UnexpectedReaderErrorsAreNotRetried()
    {
        Assert.Throws<InvalidOperationException>(() => ReaderStartupReadiness.WaitForReady(LaunchId,
            TimeSpan.FromSeconds(45), _ => throw new InvalidOperationException(),
            () => TimeSpan.Zero, _ => throw new InvalidOperationException()));
    }

    [Fact]
    public void HttpRequestAuthenticatesAndCarriesCancellation()
    {
        var endpoint = new Uri("http://127.0.0.1:4787/coverage/startup");
        using var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(ReadyResponse()) };
        using var handler = new StatusHandler((request, cancellation) =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal(endpoint, request.RequestUri);
            Assert.Equal(AppCoverage.Token, Assert.Single(request.Headers.GetValues("X-Bible-Coverage-Token")));
            Assert.True(cancellation.CanBeCanceled);
            return Task.FromResult(response);
        });
        using var client = new HttpClient(handler);
        Assert.Equal(ReadyResponse(), ReaderStartupReadiness.ReadStatus(client, endpoint, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void HttpErrorsReachThePollingPolicy()
    {
        using var response = new HttpResponseMessage(HttpStatusCode.Unauthorized);
        using var handler = new StatusHandler((_, _) => Task.FromResult(response));
        using var client = new HttpClient(handler);
        Assert.Throws<HttpRequestException>(() => ReaderStartupReadiness.ReadStatus(client,
            new Uri("http://127.0.0.1:4787/coverage/startup"), TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public void RequestDeadlineCancelsAnUnansweredHttpRequest()
    {
        using var handler = new StatusHandler(async (_, cancellation) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellation);
            throw new InvalidOperationException();
        });
        using var client = new HttpClient(handler);
        Assert.ThrowsAny<OperationCanceledException>(() => ReaderStartupReadiness.ReadStatus(client,
            new Uri("http://127.0.0.1:4787/coverage/startup"), TimeSpan.FromMilliseconds(1)));
    }

    private static string ReadyResponse() =>
        $"{{\"ok\":true,\"ready\":true,\"launchId\":\"{LaunchId}\"}}";

    private sealed class FakeClock
    {
        public TimeSpan Elapsed { get; private set; }
        public List<TimeSpan> Pauses { get; } = [];
        public void Advance(TimeSpan duration) => Elapsed += duration;
        public void Pause(TimeSpan duration)
        {
            Pauses.Add(duration);
            Advance(duration);
        }
    }

    private sealed class StatusHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            send(request, cancellationToken);
    }
}
