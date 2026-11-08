using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class PushNotificationServiceTests
{
    private sealed class FakePlatformClient : IPushPlatformClient
    {
        public bool Supported { get; set; } = true;
        public PushPermissionState Permission { get; set; } = PushPermissionState.Granted;
        public PushPermissionState RequestResult { get; set; } = PushPermissionState.Granted;
        public string? Token { get; set; } = "fcm-token";
        public string? InstallationId { get; set; } = "fid-123";
        public bool FailSubscribe { get; set; }
        public bool FailUnsubscribe { get; set; }
        public bool FailInitialize { get; set; }
        public bool FailTokens { get; set; }
        public int InitializeCalls { get; private set; }
        public int PermissionRequests { get; private set; }
        public List<string> Subscribed { get; } = [];
        public List<string> Unsubscribed { get; } = [];

        public bool IsSupported => Supported;
#pragma warning disable S1172 // Fake satisfies the platform contract; ct is interface-required but unused.
        public Task InitializeAsync(CancellationToken ct)
        {
            InitializeCalls++;
            if (FailInitialize)
            {
                throw new InvalidOperationException("init failed");
            }
            return Task.CompletedTask;
        }
        public Task<PushPermissionState> GetPermissionStateAsync(CancellationToken ct) => Task.FromResult(Permission);
        public Task<PushPermissionState> RequestPermissionAsync(CancellationToken ct)
        {
            PermissionRequests++;
            return Task.FromResult(RequestResult);
        }
        public Task<string?> GetTokenAsync(CancellationToken ct) =>
            FailTokens ? Task.FromException<string?>(new InvalidOperationException("token failed")) : Task.FromResult(Token);
        public Task<string?> GetInstallationIdAsync(CancellationToken ct) =>
            FailTokens ? Task.FromException<string?>(new InvalidOperationException("fid failed")) : Task.FromResult(InstallationId);
        public Task SubscribeToTopicAsync(string topic, CancellationToken ct)
        {
            if (FailSubscribe)
            {
                throw new InvalidOperationException("subscribe failed");
            }
            Subscribed.Add(topic);
            return Task.CompletedTask;
        }
        public Task UnsubscribeFromTopicAsync(string topic, CancellationToken ct)
        {
            Unsubscribed.Add(topic);
            if (FailUnsubscribe)
            {
                throw new InvalidOperationException("unsubscribe failed");
            }
            return Task.CompletedTask;
        }

#pragma warning restore S1172

        private EventHandler<IReadOnlyDictionary<string, string>>? _notificationTapped;
        private EventHandler<string>? _tokenRefreshed;

        // Explicit accessors keep the fake to the contract's shape — static
        // analysis cannot see the service subscribing through the interface
        // and flags plainly-declared events as unused.
        public event EventHandler<IReadOnlyDictionary<string, string>>? NotificationTapped
        {
            add => _notificationTapped += value;
            remove => _notificationTapped -= value;
        }
        public event EventHandler<string>? TokenRefreshed
        {
            add => _tokenRefreshed += value;
            remove => _tokenRefreshed -= value;
        }

        public void RaiseTapped(IReadOnlyDictionary<string, string> data) => _notificationTapped?.Invoke(this, data);
        public void RaiseTokenRefreshed(string token) => _tokenRefreshed?.Invoke(this, token);
    }

    private sealed class FakeRegistry : IPushDeviceRegistry
    {
        public List<PushDeviceRegistration> Registrations { get; } = [];
        public List<string> Unregistrations { get; } = [];
        public bool FailNext { get; set; }

#pragma warning disable S1172 // Fake satisfies the registry contract; ct is interface-required but unused.
        public Task RegisterAsync(PushDeviceRegistration registration, CancellationToken ct)
        {
            if (FailNext)
            {
                throw new HttpRequestException("not deployed");
            }
            Registrations.Add(registration);
            return Task.CompletedTask;
        }
        public Task UnregisterAsync(string userId, CancellationToken ct)
        {
            if (FailNext)
            {
                throw new HttpRequestException("not deployed");
            }
            Unregistrations.Add(userId);
            return Task.CompletedTask;
        }
#pragma warning restore S1172
    }

    private sealed class FaultingStateStore : IPushStateStore
    {
        public InMemoryPushStateStore Inner { get; } = new();
        public string? FailSetKey { get; set; }
        public string? FailGetKey { get; set; }

        public Task<string?> GetAsync(string key, CancellationToken ct) =>
            key == FailGetKey
                ? Task.FromException<string?>(new IOException("state read failed"))
                : Inner.GetAsync(key, ct);

        public Task SetAsync(string key, string value, CancellationToken ct) =>
            key == FailSetKey
                ? Task.FromException(new IOException("state write failed"))
                : Inner.SetAsync(key, value, ct);

        public Task RemoveAsync(string key, CancellationToken ct) => Inner.RemoveAsync(key, ct);
    }

    private static (PushNotificationService service, FakePlatformClient platform,
        PreferencesService prefs, InMemoryPushStateStore store, FakeRegistry registry) CreateService() =>
        CreateService(true, PushPermissionState.Granted);

    private static (PushNotificationService service, FakePlatformClient platform,
        PreferencesService prefs, InMemoryPushStateStore store, FakeRegistry registry) CreateService(
        bool supported, PushPermissionState permission)
    {
        var platform = new FakePlatformClient { Supported = supported, Permission = permission };
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var store = new InMemoryPushStateStore();
        var registry = new FakeRegistry();
        var service = PushNotificationService.CreateForTesting(
            platform, prefs, store, registry, () => "9.9.9");
        return (service, platform, prefs, store, registry);
    }

    [Fact]
    public async Task SetEnabledAsync_WhenGranted_SubscribesTopicPersistsPreferenceAndRegisters()
    {
        var (service, platform, prefs, _, registry) = CreateService();

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Enabled);
        prefs.DailyPerekPushEnabled.Should().BeTrue();
        platform.Subscribed.Should().Equal(PushNotificationService.DailyPerekTopic);
        platform.InitializeCalls.Should().Be(1);
        registry.Registrations.Should().ContainSingle();
        var row = registry.Registrations[0];
        row.Token.Should().Be("fcm-token");
        row.InstallationId.Should().Be("fid-123");
        row.UserId.Should().Be("fid-123", "the FID seeds the durable user identity");
        row.Platform.Should().Be("other", "the test host is neither Android nor iOS");
        row.Topics.Should().Equal(PushNotificationService.DailyPerekTopic);
        row.AppVersion.Should().Be("9.9.9");
    }

    [Fact]
    public async Task SetEnabledAsync_WhenPermissionDenied_LeavesPreferenceOffWithoutSubscribe()
    {
        var (service, platform, prefs, _, registry) = CreateService(true, PushPermissionState.Denied);

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.PermissionDenied);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.Subscribed.Should().BeEmpty();
        registry.Registrations.Should().BeEmpty();
    }

    [Fact]
    public async Task SetEnabledAsync_WhenNotDetermined_RequestsPermissionFirst()
    {
        var (service, platform, _, _, _) = CreateService(true, PushPermissionState.NotDetermined);
        platform.RequestResult = PushPermissionState.Granted;

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Enabled);
        platform.PermissionRequests.Should().Be(1);
    }

    [Fact]
    public async Task SetEnabledAsync_WhenRequestDenied_ReturnsDeniedWithoutSubscribe()
    {
        var (service, platform, _, _, _) = CreateService(true, PushPermissionState.NotDetermined);
        platform.RequestResult = PushPermissionState.Denied;

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.PermissionDenied);
        platform.Subscribed.Should().BeEmpty();
    }

    [Fact]
    public async Task SetEnabledAsync_WhenSubscribeFails_ReportsFailedAndKeepsPreferenceOff()
    {
        var (service, platform, prefs, _, _) = CreateService();
        platform.FailSubscribe = true;

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Failed);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
    }

    [Fact]
    public async Task SetEnabledAsync_OnUnsupportedPlatform_ReturnsUnsupportedWithoutWork()
    {
        var (service, platform, prefs, _, _) = CreateService(false, PushPermissionState.Granted);

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Unsupported);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.InitializeCalls.Should().Be(0);
    }

    [Fact]
    public async Task SetEnabledAsync_Disable_UnsubscribesTopicAndUnregisters()
    {
        var (service, platform, prefs, _, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);

        var result = await service.SetEnabledAsync(false, CancellationToken.None);

        result.Should().Be(PushEnableResult.Disabled);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.Unsubscribed.Should().Equal(PushNotificationService.DailyPerekTopic);
        registry.Unregistrations.Should().Equal("fid-123");
    }

    [Fact]
    public async Task SetEnabledAsync_Disable_WhenUnsubscribeFails_RetriesOnNextLaunchWhileOptedOut()
    {
        var (service, platform, prefs, store, _) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);
        platform.FailUnsubscribe = true;

        var result = await service.SetEnabledAsync(false, CancellationToken.None);

        result.Should().Be(PushEnableResult.Disabled, "the local opt-out stands even when FCM is unreachable");
        prefs.DailyPerekPushEnabled.Should().BeFalse();

        // Relaunch with connectivity restored: the deferred unsubscribe must
        // run even though the preference is off — otherwise the FCM topic
        // membership outlives the toggle and the device keeps receiving pushes.
        platform.FailUnsubscribe = false;
        var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, new FakeRegistry(), () => "9.9.9");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.Unsubscribed.Should().Equal(
            PushNotificationService.DailyPerekTopic, // the failed attempt
            PushNotificationService.DailyPerekTopic); // the deferred retry
        platform.Subscribed.Should().HaveCount(1, "only the initial opt-in subscribes — no re-enable happened");
    }

    [Fact]
    public async Task SetEnabledAsync_Reenable_ClearsPendingUnsubscribe()
    {
        var (service, platform, prefs, store, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);
        platform.FailUnsubscribe = true;
        await service.SetEnabledAsync(false, CancellationToken.None);
        platform.FailUnsubscribe = false;

        await service.SetEnabledAsync(true, CancellationToken.None);
        await service.SetEnabledAsync(false, CancellationToken.None);

        // Re-opt-in re-subscribed and cleared the marker, so this opt-out's
        // unsubscribe is a normal one — no deferred retry on the next launch.
        platform.Unsubscribed.Should().HaveCount(2);
        var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);
        platform.Unsubscribed.Should().HaveCount(2);
    }

    [Fact]
    public async Task SetEnabledAsync_Disable_WithoutResolvedIdentity_UnregistersPersistedUserId()
    {
        var (service, platform, prefs, store, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);

        // A fresh instance has no resolved _userId; the persisted identity
        // from the original registration must still drive the unregister.
        var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");
        var result = await relaunch.SetEnabledAsync(false, CancellationToken.None);

        result.Should().Be(PushEnableResult.Disabled);
        registry.Unregistrations.Should().Equal("fid-123");
    }

    [Fact]
    public async Task SetEnabledAsync_WhenRegistryDown_StillEnables()
    {
        var (service, _, prefs, _, registry) = CreateService();
        registry.FailNext = true;

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Enabled, "registration is best-effort while the backend is deferred");
        prefs.DailyPerekPushEnabled.Should().BeTrue();
    }

    [Fact]
    public async Task ApplyEnabledPreferenceAsync_WhenOptedIn_ResubscribesAndRegisters()
    {
        var (service, platform, prefs, _, registry) = CreateService();
        prefs.DailyPerekPushEnabled = true;

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.Subscribed.Should().Equal(PushNotificationService.DailyPerekTopic);
        registry.Registrations.Should().ContainSingle();
    }

    [Fact]
    public async Task ApplyEnabledPreferenceAsync_WhenOptedOut_DoesNothing()
    {
        var (service, platform, _, _, registry) = CreateService();

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.Subscribed.Should().BeEmpty();
        registry.Registrations.Should().BeEmpty();
    }

    [Fact]
    public async Task ApplyEnabledPreferenceAsync_WhenPermissionRevoked_KeepsPreferenceButSkipsSubscribe()
    {
        var (service, platform, prefs, _, _) = CreateService(true, PushPermissionState.Denied);
        prefs.DailyPerekPushEnabled = true;

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.Subscribed.Should().BeEmpty();
        prefs.DailyPerekPushEnabled.Should().BeTrue("the stored opt-in records user intent");
    }

    [Fact]
    public async Task ApplyEnabledPreferenceAsync_RunsOncePerServiceInstance()
    {
        var (service, platform, prefs, _, _) = CreateService();
        prefs.DailyPerekPushEnabled = true;

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);
        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.Subscribed.Should().ContainSingle();
    }

    [Fact]
    public async Task SyncRegistration_WhenFingerprintUnchanged_SkipsRepeatRegistration()
    {
        // First launch: enable registers and stores the fingerprint.
        var platform = new FakePlatformClient();
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var store = new InMemoryPushStateStore();
        var registry = new FakeRegistry();
        var service = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");
        await service.SetEnabledAsync(true, CancellationToken.None);

        // Second launch (new instance, same stores): apply re-subscribes the
        // topic but must not re-POST an identical registration.
        var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);

        registry.Registrations.Should().ContainSingle();
    }

    [Fact]
    public async Task TokenRefreshed_WhenEnabled_ReregistersWithNewToken()
    {
        var (service, platform, _, _, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);

        platform.RaiseTokenRefreshed("fcm-token-2");
        await service.LastTokenResync!;

        registry.Registrations.Should().HaveCount(2);
        registry.Registrations[1].Token.Should().Be("fcm-token-2");
        registry.Registrations[1].UserId.Should().Be("fid-123");
        service.CurrentToken.Should().Be("fcm-token-2");
    }

    [Fact]
    public async Task Identity_WithoutFid_GeneratesAndPersistsUserId()
    {
        var platform = new FakePlatformClient { InstallationId = null };
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var store = new InMemoryPushStateStore();
        var registry = new FakeRegistry();
        var service = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");

        await service.SetEnabledAsync(true, CancellationToken.None);
        var firstId = registry.Registrations[0].UserId;

        // Relaunch with a different FID — the stored user id must win so a
        // rotating token re-links to the same identity (per the issue design).
        var relaunchPlatform = new FakePlatformClient { InstallationId = "fid-new" };
        var relaunch = PushNotificationService.CreateForTesting(relaunchPlatform, prefs, store, registry, () => "9.9.9");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);

        firstId.Should().NotBeNullOrEmpty();
        registry.Registrations.Should().HaveCount(2);
        registry.Registrations[1].UserId.Should().Be(firstId);
        registry.Registrations[1].InstallationId.Should().Be("fid-new");
    }

    [Fact]
    public async Task NotificationTapped_WithPerekUrl_RoutesIntoAppLinkChannel()
    {
        var (service, platform, _, _, _) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);
        try
        {
            platform.RaiseTapped(new Dictionary<string, string> { ["url"] = "/929/123" });

            AppLinkHelper.PendingTarget.Should().Be(new AppLinkHelper.AppLinkTarget(123, null));
        }
        finally
        {
            AppLinkHelper.PendingTarget = null;
        }
    }

    [Theory]
    [InlineData("/929/42", 42, null)]
    [InlineData("https://xn--febl3a.co.il/929/5", 5, null)]
    [InlineData("https://xn--febl3a.com/929/5/7", 5, 7)]
    public void ResolveTarget_ValidPerekUrls_ResolveToAppLinkTarget(string url, int perek, int? article)
    {
        var data = new Dictionary<string, string> { ["url"] = url };

        PushNotificationService.ResolveTarget(data).Should().Be(new AppLinkHelper.AppLinkTarget(perek, article));
    }

    [Theory]
    [InlineData("https://evil.example.com/929/5")]
    [InlineData("not a url")]
    [InlineData("/other/path")]
    [InlineData("/929/0")]
    [InlineData("/929/930")]
    public void ResolveTarget_InvalidOrNonPerekUrls_ReturnNull(string url)
    {
        var data = new Dictionary<string, string> { ["url"] = url };

        PushNotificationService.ResolveTarget(data).Should().BeNull();
    }

    [Fact]
    public void ResolveTarget_MissingUrlKeyOrNullData_ReturnsNull()
    {
        PushNotificationService.ResolveTarget(null).Should().BeNull();
        PushNotificationService.ResolveTarget(new Dictionary<string, string>()).Should().BeNull();
    }

    [Fact]
    public async Task SetEnabledAsync_WhenPlatformInitFails_ReportsFailed()
    {
        var (service, platform, prefs, _, _) = CreateService();
        platform.FailInitialize = true;

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Failed);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.Subscribed.Should().BeEmpty();
    }

    [Fact]
    public async Task EnsureInitializedAsync_WhenUnsupported_CompletesWithoutPlatformWork()
    {
        var (service, platform, _, _, _) = CreateService(false, PushPermissionState.Granted);

        await service.EnsureInitializedAsync(CancellationToken.None);
        await service.EnsureInitializedAsync(CancellationToken.None);
        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        platform.InitializeCalls.Should().Be(0);
    }

    [Fact]
    public async Task EnsureInitializedAsync_WhenSupported_SharesSingleAttempt()
    {
        var (service, platform, _, _, _) = CreateService();

        await Task.WhenAll(
            service.EnsureInitializedAsync(CancellationToken.None),
            service.EnsureInitializedAsync(CancellationToken.None));

        platform.InitializeCalls.Should().Be(1);
    }

    [Fact]
    public async Task SetEnabledAsync_WhenIdentityFetchFails_StillEnablesWithFallbackUserId()
    {
        var platform = new FakePlatformClient { FailTokens = true };
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        prefs.Load();
        var store = new InMemoryPushStateStore();
        var registry = new FakeRegistry();
        var service = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "9.9.9");

        var result = await service.SetEnabledAsync(true, CancellationToken.None);

        result.Should().Be(PushEnableResult.Enabled);
        platform.Subscribed.Should().Equal(PushNotificationService.DailyPerekTopic);
        registry.Registrations.Should().BeEmpty("a row without a token is useless — nothing to register");
        service.NotificationUserId.Should().NotBeNullOrEmpty("the GUID fallback still seeds identity");
    }

    [Fact]
    public async Task TokenRefreshed_WhenDisabled_OnlyUpdatesCurrentToken()
    {
        var (service, platform, _, _, registry) = CreateService();

        platform.RaiseTokenRefreshed("fcm-token-2");

        service.CurrentToken.Should().Be("fcm-token-2");
        registry.Registrations.Should().BeEmpty();
    }

    [Fact]
    public async Task TokenRefreshed_WhenRegistryDown_LogsAndKeepsOptIn()
    {
        var (service, platform, prefs, _, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);
        registry.FailNext = true;

        platform.RaiseTokenRefreshed("fcm-token-2");
        await service.LastTokenResync!;

        prefs.DailyPerekPushEnabled.Should().BeTrue();
    }

    [Fact]
    public void NotificationTapped_WithNonPerekData_DoesNotRoute()
    {
        var (_, platform, _, _, _) = CreateService();
        AppLinkHelper.PendingTarget = null;

        platform.RaiseTapped(new Dictionary<string, string> { ["url"] = "/donate" });
        platform.RaiseTapped(new Dictionary<string, string> { ["other"] = "x" });

        AppLinkHelper.PendingTarget.Should().BeNull();
    }

    [Fact]
    public void Dispose_UnsubscribesPlatformEvents()
    {
        var (service, platform, _, _, _) = CreateService();
        service.Dispose();
        AppLinkHelper.PendingTarget = null;

        platform.RaiseTapped(new Dictionary<string, string> { ["url"] = "/929/1" });
        platform.RaiseTokenRefreshed("fcm-token-2");

        AppLinkHelper.PendingTarget.Should().BeNull();
        service.CurrentToken.Should().BeNull();
    }

    [Fact]
    public async Task NullImplementations_AreSafeNoOps()
    {
        NullPushPlatformClient.Instance.IsSupported.Should().BeFalse();
        await NullPushPlatformClient.Instance.InitializeAsync(CancellationToken.None);
        (await NullPushPlatformClient.Instance.GetPermissionStateAsync(CancellationToken.None))
            .Should().Be(PushPermissionState.Unsupported);
        (await NullPushPlatformClient.Instance.RequestPermissionAsync(CancellationToken.None))
            .Should().Be(PushPermissionState.Unsupported);
        (await NullPushPlatformClient.Instance.GetTokenAsync(CancellationToken.None)).Should().BeNull();
        (await NullPushPlatformClient.Instance.GetInstallationIdAsync(CancellationToken.None)).Should().BeNull();
        await NullPushPlatformClient.Instance.SubscribeToTopicAsync("t", CancellationToken.None);
        await NullPushPlatformClient.Instance.UnsubscribeFromTopicAsync("t", CancellationToken.None);
        NullPushPlatformClient.Instance.RaiseTapped(new Dictionary<string, string>());
        NullPushPlatformClient.Instance.RaiseTokenRefreshed("t");
        await NullPushDeviceRegistry.Instance.RegisterAsync(
            new PushDeviceRegistration("u", "i", "t", "android", [], "1"), CancellationToken.None);
        await NullPushDeviceRegistry.Instance.UnregisterAsync("u", CancellationToken.None);

        var store = new InMemoryPushStateStore();
        await store.SetAsync("k", "v", CancellationToken.None);
        (await store.GetAsync("k", CancellationToken.None)).Should().Be("v");
        await store.RemoveAsync("k", CancellationToken.None);
        (await store.GetAsync("k", CancellationToken.None)).Should().BeNull();
    }

    [Fact]
    public async Task PreferencesService_DailyPerekPushEnabled_PersistsAcrossLoad()
    {
        var storage = new InMemoryPreferencesStorage();
        var prefs = PreferencesService.CreateForTesting(storage);
        prefs.Load();

        prefs.DailyPerekPushEnabled.Should().BeFalse("opt-in defaults off");
        prefs.DailyPerekPushEnabled = true;
        storage.Get("dailyPerekPushEnabled", false).Should().BeTrue();

        var reloaded = PreferencesService.CreateForTesting(storage);
        reloaded.Load();
        reloaded.DailyPerekPushEnabled.Should().BeTrue();
    }

    [Fact]
    public async Task UnsupportedPermission_DoesNotSubscribeOrPersistOptIn()
    {
        var (service, platform, prefs, _, registry) = CreateService(true, PushPermissionState.Unsupported);

        (await service.SetEnabledAsync(true, CancellationToken.None)).Should().Be(PushEnableResult.Unsupported);

        platform.Subscribed.Should().BeEmpty();
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        registry.Registrations.Should().BeEmpty();
    }

    [Fact]
    public async Task Disable_WhenRegistryFails_StillPersistsOptOutAndUnsubscribes()
    {
        var (service, platform, prefs, store, registry) = CreateService();
        await service.SetEnabledAsync(true, CancellationToken.None);
        registry.FailNext = true;

        (await service.SetEnabledAsync(false, CancellationToken.None)).Should().Be(PushEnableResult.Disabled);

        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.Unsubscribed.Should().Equal(PushNotificationService.DailyPerekTopic);
        (await store.GetAsync("push.registration_fingerprint", CancellationToken.None)).Should().BeNull();
    }

    [Fact]
    public async Task Disable_WhenUnsubscribeMarkerCannotBeSaved_StillUnregistersDevice()
    {
        var platform = new FakePlatformClient();
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var store = new FaultingStateStore { FailSetKey = "push.pending_unsubscribe" };
        var registry = new FakeRegistry();
        using var service = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "1");
        await service.SetEnabledAsync(true, CancellationToken.None);
        platform.FailUnsubscribe = true;

        (await service.SetEnabledAsync(false, CancellationToken.None)).Should().Be(PushEnableResult.Disabled);

        prefs.DailyPerekPushEnabled.Should().BeFalse();
        registry.Unregistrations.Should().Equal("fid-123");
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Startup_WhenPermissionOrSubscriptionFails_PreservesIntentForNextLaunch(bool subscribeFailure)
    {
        var (service, platform, prefs, store, registry) = CreateService();
        prefs.DailyPerekPushEnabled = true;
        platform.Permission = subscribeFailure ? PushPermissionState.Granted : PushPermissionState.Denied;
        platform.FailSubscribe = subscribeFailure;

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        prefs.DailyPerekPushEnabled.Should().BeTrue();
        registry.Registrations.Should().BeEmpty();
        platform.Permission = PushPermissionState.Granted;
        platform.FailSubscribe = false;
        using var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "1");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);
        registry.Registrations.Should().ContainSingle();
    }

    [Fact]
    public async Task DeferredUnsubscribe_WhenRetryFails_KeepsMarkerUntilSuccessfulLaunch()
    {
        var (service, platform, prefs, store, registry) = CreateService();
        platform.FailUnsubscribe = true;
        await service.SetEnabledAsync(false, CancellationToken.None);

        await service.ApplyEnabledPreferenceAsync(CancellationToken.None);

        (await store.GetAsync("push.pending_unsubscribe", CancellationToken.None))
            .Should().Be(PushNotificationService.DailyPerekTopic);
        prefs.DailyPerekPushEnabled.Should().BeFalse();
        platform.FailUnsubscribe = false;
        using var relaunch = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "1");
        await relaunch.ApplyEnabledPreferenceAsync(CancellationToken.None);
        (await store.GetAsync("push.pending_unsubscribe", CancellationToken.None)).Should().BeNull();
        registry.Registrations.Should().BeEmpty();
    }

    [Fact]
    public async Task TokenRefresh_WhenStateReadFails_DoesNotEscapeAndCanRecover()
    {
        var platform = new FakePlatformClient();
        var prefs = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var store = new FaultingStateStore();
        var registry = new FakeRegistry();
        using var service = PushNotificationService.CreateForTesting(platform, prefs, store, registry, () => "1");
        await service.SetEnabledAsync(true, CancellationToken.None);
        store.FailGetKey = "push.registration_fingerprint";

        platform.RaiseTokenRefreshed("rotated-token");
        await service.LastTokenResync!;

        prefs.DailyPerekPushEnabled.Should().BeTrue();
        registry.Registrations.Should().ContainSingle();
        store.FailGetKey = null;
        platform.RaiseTokenRefreshed("rotated-token");
        await service.LastTokenResync!;
        registry.Registrations.Should().HaveCount(2);
        registry.Registrations[1].Token.Should().Be("rotated-token");
    }

    [Fact]
    public void NullPlatformEvents_CanBeUnsubscribed()
    {
        var platform = NullPushPlatformClient.Instance;
        var taps = 0;
        var tokens = 0;
        EventHandler<IReadOnlyDictionary<string, string>> onTap = (_, _) => taps++;
        EventHandler<string> onToken = (_, _) => tokens++;
        platform.NotificationTapped += onTap;
        platform.TokenRefreshed += onToken;
        try
        {
            platform.RaiseTapped(new Dictionary<string, string>());
            platform.RaiseTokenRefreshed("token");
        }
        finally
        {
            platform.NotificationTapped -= onTap;
            platform.TokenRefreshed -= onToken;
        }
        platform.RaiseTapped(new Dictionary<string, string>());
        platform.RaiseTokenRefreshed("token");
        taps.Should().Be(1);
        tokens.Should().Be(1);
    }
}
