using BibleOnSite.Services;
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
        using var service = new NetworkService(connectivity.Object, () => { calls++; return Task.CompletedTask; });
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
        service.StopMonitoring();
        Raise(connectivity, NetworkAccess.None);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(2);
        service.StartMonitoring();
        service.Dispose();
        service.Dispose();
        service.StartMonitoring();
        connectivity.VerifyAdd(c => c.ConnectivityChanged += It.IsAny<EventHandler<ConnectivityChangedEventArgs>>(), Times.Exactly(2));
    }

    [Fact]
    public async Task DuplicateOnlineEvents_DuringRefresh_DoNotStartAnotherRequest()
    {
        var connectivity = new Mock<IConnectivity>();
        connectivity.SetupGet(c => c.NetworkAccess).Returns(NetworkAccess.None);
        var pending = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        using var service = new NetworkService(connectivity.Object, () => { calls++; return pending.Task; });
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
        using var service = new NetworkService(connectivity.Object, () => { calls++; throw new IOException("offline"); });
        service.StartMonitoring();
        Raise(connectivity, NetworkAccess.Internet);
        Raise(connectivity, NetworkAccess.None);
        Raise(connectivity, NetworkAccess.Internet);
        calls.Should().Be(2);
    }
}
