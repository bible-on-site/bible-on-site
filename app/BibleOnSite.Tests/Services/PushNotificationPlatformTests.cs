using System.Net;
using System.Text.Json;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.Storage;
using Moq;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class HttpPushDeviceRegistryTests
{
    private sealed class CaptureHandler(HttpStatusCode status) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest;
        public string? LastBody;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken ct)
        {
            LastRequest = request;
            LastBody = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(status);
        }
    }

    private static HttpPushDeviceRegistry CreateRegistry(HttpClient http) =>
        new(http, () => "https://site.example");

    [Fact]
    public async Task RegisterAsync_PostsContractPayloadToDeviceRoute()
    {
        var handler = new CaptureHandler(HttpStatusCode.OK);
        using var http = new HttpClient(handler);
        var registry = CreateRegistry(http);
        var registration = new PushDeviceRegistration(
            "user-1", "fid-1", "token-1", "android", ["daily_perek"], "5.1.8");

        await registry.RegisterAsync(registration, CancellationToken.None);

        handler.LastRequest.Should().NotBeNull();
        handler.LastRequest!.Method.Should().Be(HttpMethod.Post);
        handler.LastRequest.RequestUri!.ToString().Should().Be("https://site.example/api/push/device");
        using var doc = JsonDocument.Parse(handler.LastBody!);
        var root = doc.RootElement;
        root.GetProperty("userId").GetString().Should().Be("user-1");
        root.GetProperty("installationId").GetString().Should().Be("fid-1");
        root.GetProperty("token").GetString().Should().Be("token-1");
        root.GetProperty("platform").GetString().Should().Be("android");
        root.GetProperty("topics").EnumerateArray().Select(e => e.GetString()).Should().Equal("daily_perek");
        root.GetProperty("appVersion").GetString().Should().Be("5.1.8");
    }

    [Fact]
    public async Task UnregisterAsync_DeletesWithUserIdBody()
    {
        var handler = new CaptureHandler(HttpStatusCode.OK);
        using var http = new HttpClient(handler);
        var registry = CreateRegistry(http);

        await registry.UnregisterAsync("user-1", CancellationToken.None);

        handler.LastRequest!.Method.Should().Be(HttpMethod.Delete);
        handler.LastRequest.RequestUri!.ToString().Should().Be("https://site.example/api/push/device");
        using var doc = JsonDocument.Parse(handler.LastBody!);
        doc.RootElement.GetProperty("userId").GetString().Should().Be("user-1");
    }

    [Fact]
    public async Task RegisterAsync_OnNonSuccess_ThrowsForCallerToLog()
    {
        var handler = new CaptureHandler(HttpStatusCode.NotFound);
        using var http = new HttpClient(handler);
        var registry = CreateRegistry(http);

        await registry
            .Invoking(r => r.RegisterAsync(
                new PushDeviceRegistration("u", "i", "t", "android", [], "1"), CancellationToken.None))
            .Should().ThrowAsync<HttpRequestException>();
    }
}

public class MauiPushStateStoreTests
{
    [Fact]
    public async Task SecureStore_IsUsedWhenPlatformChoosesKeychain()
    {
        var secure = new Mock<ISecureStorage>();
        var preferences = new Mock<IPreferences>();
        secure.Setup(s => s.GetAsync("k")).ReturnsAsync("v");
        var store = new MauiPushStateStore(secure.Object, preferences.Object, useSecure: true);

        (await store.GetAsync("k", CancellationToken.None)).Should().Be("v");
        await store.SetAsync("k", "v2", CancellationToken.None);
        await store.RemoveAsync("k", CancellationToken.None);

        secure.Verify(s => s.SetAsync("k", "v2"), Times.Once);
        secure.Verify(s => s.Remove("k"), Times.Once);
        preferences.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task PreferencesStore_IsUsedWhenPlatformChoosesBackup()
    {
        var secure = new Mock<ISecureStorage>();
        var preferences = new Mock<IPreferences>();
        preferences.Setup(p => p.Get<string?>("k", null, null)).Returns("v");
        var store = new MauiPushStateStore(secure.Object, preferences.Object, useSecure: false);

        (await store.GetAsync("k", CancellationToken.None)).Should().Be("v");
        await store.SetAsync("k", "v2", CancellationToken.None);
        await store.RemoveAsync("k", CancellationToken.None);

        preferences.Verify(p => p.Set("k", "v2", null), Times.Once);
        preferences.Verify(p => p.Remove("k", null), Times.Once);
        secure.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task SecureReadFailure_ReturnsNullSoIdentityReseeds()
    {
        var secure = new Mock<ISecureStorage>();
        secure.Setup(s => s.GetAsync("k")).ThrowsAsync(new InvalidOperationException("corrupt"));
        var store = new MauiPushStateStore(secure.Object, Mock.Of<IPreferences>(), useSecure: true);

        (await store.GetAsync("k", CancellationToken.None)).Should().BeNull();
    }
}

public class PerekPreferencesViewModelPushTests
{
    private sealed class FakePush : IPushNotificationService
    {
        public PushEnableResult NextResult = PushEnableResult.Enabled;
        public bool Supported = true;
        public Task<PushEnableResult>? PendingResult { get; set; }
        public bool Fail { get; set; }
        public List<bool> SetCalls { get; } = [];

        public bool IsSupported => Supported;
        public string? CurrentToken => null;
        public string? NotificationUserId => null;
#pragma warning disable S1172 // Fake satisfies the service contract; unused arguments are interface-required.
        public Task<PushEnableResult> SetEnabledAsync(bool enabled, CancellationToken ct)
        {
            SetCalls.Add(enabled);
            return Fail
                ? Task.FromException<PushEnableResult>(new IOException("push unavailable"))
                : PendingResult ?? Task.FromResult(NextResult);
        }
        public Task ApplyEnabledPreferenceAsync(CancellationToken ct) => Task.CompletedTask;
        public void DispatchNotificationTap(IReadOnlyDictionary<string, string>? data)
        {
            // Taps are asserted through AppLinkHelper, not this fake.
        }
        public Task EnsureInitializedAsync(CancellationToken ct) => Task.CompletedTask;
#pragma warning restore S1172
    }

    private sealed class FakeNavigator(bool choiceResult) : IAppNavigator
    {
        public int ChoiceCalls;
        public int AlertCalls;
#pragma warning disable S1172 // Fake satisfies the navigator contract; route/text arguments unused.
        public Task GoToAsync(string route) => Task.CompletedTask;
        public Task GoToAsync(string route, bool animate, IDictionary<string, object>? parameters) => Task.CompletedTask;
        public Task GoToQueuedAsync(string route) => Task.CompletedTask;
        public Task DisplayAlertAsync(string title, string message, string cancel)
        {
            AlertCalls++;
            return Task.CompletedTask;
        }
        public Task<bool> DisplayChoiceAsync(string title, string message, string accept, string cancel)
        {
            ChoiceCalls++;
            return Task.FromResult(choiceResult);
        }
        public Task<bool> DisplayDestructiveChoiceAsync(string title, string message, string destructive, string cancel) =>
            Task.FromResult(choiceResult);
#pragma warning restore S1172
    }

    [Fact]
    public async Task DailyPerekPushEnabled_SetTrue_DelegatesToPushService()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var push = new FakePush();
        var vm = new PerekPreferencesViewModel(prefs, push, new FakeNavigator(false));

        await vm.SetDailyPerekPushAsync(true);

        push.SetCalls.Should().Equal(true);
    }

    [Fact]
    public async Task DailyPerekPushEnabled_WhenDenied_OpensExplanationDialog()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var push = new FakePush { NextResult = PushEnableResult.PermissionDenied };
        var navigator = new FakeNavigator(false);
        var vm = new PerekPreferencesViewModel(prefs, push, navigator);

        await vm.SetDailyPerekPushAsync(true);

        navigator.ChoiceCalls.Should().Be(1, "denial explains where to re-enable in system settings");
        prefs.DailyPerekPushEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task DailyPerekPushEnabled_WhenFailed_ShowsAlert()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var push = new FakePush { NextResult = PushEnableResult.Failed };
        var navigator = new FakeNavigator(false);
        var vm = new PerekPreferencesViewModel(prefs, push, navigator);

        await vm.SetDailyPerekPushAsync(true);

        navigator.AlertCalls.Should().Be(1);
    }

    [Fact]
    public void NotificationsSupported_MirrorsPlatformSupport()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();

        new PerekPreferencesViewModel(prefs, new FakePush { Supported = true }, new FakeNavigator(false))
            .NotificationsSupported.Should().BeTrue();
        new PerekPreferencesViewModel(prefs, new FakePush { Supported = false }, new FakeNavigator(false))
            .NotificationsSupported.Should().BeFalse();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void DailyPerekPushEnabled_WhenUnchanged_DoesNotCallPlatform(bool enabled)
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.DailyPerekPushEnabled = enabled;
        var push = new FakePush();
        var vm = new PerekPreferencesViewModel(prefs, push, new FakeNavigator(false));

        vm.DailyPerekPushEnabled = enabled;
        prefs.DailyPerekPushEnabled = enabled;

        vm.DailyPerekPushEnabled.Should().Be(enabled);
        push.SetCalls.Should().BeEmpty();
    }

    [Fact]
    public async Task DailyPerekPushEnabled_DoesNotStartOverlappingChanges_AndAllowsRetry()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var completion = new TaskCompletionSource<PushEnableResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        var push = new FakePush { PendingResult = completion.Task };
        var vm = new PerekPreferencesViewModel(prefs, push, new FakeNavigator(false));
        var change = vm.SetDailyPerekPushAsync(true);

        vm.DailyPerekPushEnabled = true;
        push.SetCalls.Should().Equal(true);
        completion.SetResult(PushEnableResult.Enabled);
        await change;
        vm.DailyPerekPushEnabled = true;

        push.SetCalls.Should().Equal(true, true);
    }

    [Fact]
    public async Task DailyPerekPushEnabled_WhenDenied_CanAcceptOpeningSystemSettings()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var push = new FakePush { NextResult = PushEnableResult.PermissionDenied };
        var navigator = new FakeNavigator(true);
        var vm = new PerekPreferencesViewModel(prefs, push, navigator);

        await vm.SetDailyPerekPushAsync(true);

        navigator.ChoiceCalls.Should().Be(1);
        vm.DailyPerekPushEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task DailyPerekPushEnabled_WhenPlatformThrows_NotifiesAndAllowsRetry()
    {
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var push = new FakePush { Fail = true };
        var vm = new PerekPreferencesViewModel(prefs, push, new FakeNavigator(false));
        var properties = new List<string?>();
        vm.PropertyChanged += (_, e) => properties.Add(e.PropertyName);

        await vm.SetDailyPerekPushAsync(true);

        properties.Should().Contain(nameof(PerekPreferencesViewModel.DailyPerekPushEnabled));
        vm.DailyPerekPushEnabled.Should().BeFalse();
        push.Fail = false;
        vm.DailyPerekPushEnabled = true;
        push.SetCalls.Should().Equal(true, true);
    }
}
