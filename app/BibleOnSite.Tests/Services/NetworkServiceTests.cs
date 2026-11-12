using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.Networking;

namespace BibleOnSite.Tests.Services;

public class NetworkServiceTests
{
    private static void Raise(Mock<IConnectivity> connectivity, NetworkAccess access) =>
        connectivity.Raise(c => c.ConnectivityChanged += null,
            new ConnectivityChangedEventArgs(access, [ConnectionProfile.WiFi]));

    [Fact]
    public void Monitoring_RefreshesOnlyOnOfflineToOnlineTransitions_AndSubscribesOnce()
    {
        var connectivity = new Mock<IConnectivity>();
        connectivity.SetupGet(c => c.NetworkAccess).Returns(NetworkAccess.Internet);
        var calls = 0;
        var service = new NetworkService(connectivity.Object, () => { calls++; return Task.CompletedTask; });
        service.StartMonitoring();
        service.StartMonitoring();
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(0);
        Raise(connectivity, NetworkAccess.Local);
        Raise(connectivity, NetworkAccess.Internet);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(1);
        Raise(connectivity, NetworkAccess.None);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(2);
        connectivity.VerifyAdd(c => c.ConnectivityChanged += It.IsAny<EventHandler<ConnectivityChangedEventArgs>>(), Times.Once());
    }

    [Fact]
    public async Task DuplicateOnlineEvents_DuringRefresh_DoNotStartAnotherRequest()
    {
        var connectivity = new Mock<IConnectivity>();
        connectivity.SetupGet(c => c.NetworkAccess).Returns(NetworkAccess.None);
        var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var service = new NetworkService(connectivity.Object, () => { calls++; return pending.Task; });
        service.StartMonitoring();
        Raise(connectivity, NetworkAccess.Internet);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(1);
        pending.SetResult();
        await pending.Task;
    }

    [Fact]
    public void RefreshFailure_DoesNotPreventLaterReconnects()
    {
        var connectivity = new Mock<IConnectivity>();
        var calls = 0;
        var service = new NetworkService(connectivity.Object, () => { calls++; throw new IOException("offline"); });
        service.StartMonitoring();
        Raise(connectivity, NetworkAccess.Internet);
        Raise(connectivity, NetworkAccess.None);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(2);
    }

    [Fact]
    public void Instance_OnUnitTestHost_ThrowsPlatformNotImplemented()
    {
        // The singleton binds Connectivity.Current, which has no implementation
        // in the unit-test host.
        var act = () => _ = NetworkService.Instance;

        act.Should().Throw<NotImplementedException>();
    }

    [Fact]
    public void IsOnline_OnUnitTestHost_ThrowsPlatformNotImplemented()
    {
        var act = () => _ = NetworkService.IsOnline;

        act.Should().Throw<NotImplementedException>();
    }

    [Fact]
    public async Task RefreshAllAsync_RefreshesEveryApiBackedCache()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport("{\"data\":{}}");
        var starter = new StarterService(http.Client, storage.FileSystem.Object);
        var moed = new MoedService(http.Client, storage.FileSystem.Object);

        await NetworkService.RefreshAllAsync(starter, moed);

        // Starter first, then the moadim catalogue — connectivity recovery
        // refreshes every API-backed cache in one pass (#3261).
        http.Requests.Should().HaveCount(2);
    }

    [Fact]
    public async Task RefreshAllBound_ResolvesTheProductionSingletons()
    {
        // The bound delegate wires the real lazy singletons — on the
        // unit-test host they construct (FileSystem.Current exists; only its
        // paths are unimplemented) and every refresh failure stays contained
        // inside TryRefreshAsync.
        var starter = StarterService.Instance;
        var snapshot = (
            starter.Authors, starter.Articles, starter.PerekArticlesCounters,
            starter.IsLoaded, starter.IsFromCache,
            HebrewDateOverrides(starter));
        try
        {
            var act = NetworkService.RefreshAllBound;

            await act.Should().NotThrowAsync();
        }
        finally
        {
            // Where the refresh reached the real API it swapped the shared
            // singleton's data — restore it so loader tests keep their empty
            // snapshot.
            var type = typeof(StarterService);
            type.GetProperty(nameof(StarterService.Authors))!.SetValue(starter, snapshot.Authors);
            type.GetProperty(nameof(StarterService.Articles))!.SetValue(starter, snapshot.Articles);
            type.GetProperty(nameof(StarterService.PerekArticlesCounters))!.SetValue(starter, snapshot.PerekArticlesCounters);
            type.GetProperty(nameof(StarterService.IsLoaded))!.SetValue(starter, snapshot.IsLoaded);
            type.GetProperty(nameof(StarterService.IsFromCache))!.SetValue(starter, snapshot.IsFromCache);
            type.GetField("_hebrewDateOverrideArticleIds",
                    System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
                .SetValue(starter, snapshot.Item6);
        }
    }

    private static object? HebrewDateOverrides(StarterService starter) =>
        typeof(StarterService)
            .GetField("_hebrewDateOverrideArticleIds",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)!
            .GetValue(starter);
}
