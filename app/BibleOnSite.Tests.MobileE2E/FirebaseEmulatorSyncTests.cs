using System.Net;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Native Firebase preference sync (#3185): the app's real
// FirebaseUserIdentity + FirestorePreferencesStore against the local
// Emulator Suite — never production. A scenario binds only when the run
// provides MOBILE_FIREBASE_EMULATOR (run.mjs spawns the suite next to
// Appium); without it the app's FIREBASE_EMULATOR build stays local-only
// and these tests skip.
//
// Android carries the endpoint through the launch intent extra —
// MainActivity persists it as the marker file, so TerminateApp +
// ActivateApp relaunches exercise the exact channel a process restart
// uses. iOS re-declares the launch environment on every launchApp, so the
// same scenario rides that channel instead. All assertions read the
// committed backend state over the emulator REST surface
// (FirebaseEmulatorBackend), and each scenario wipes the disposable
// database when it finishes. Auth accounts stay: the install's anonymous
// identity must survive between scenarios, or its cached uid points at a
// deleted account and the next assertions race token revalidation.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class FirebaseEmulatorSyncTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    private const string SyncedToggleKey = "divineNameMaskingEnabled";
    private const int DeadAuthPort = 19099;
    private const int DeadFirestorePort = 18081;

    private FirebaseEmulatorBackend? _backend;
    private string? _launcherComponent;

    public override async ValueTask InitializeAsync()
    {
        // Selection decides before any backend or device work runs — an
        // excluded scenario must not touch the emulator either.
        Assert.SkipWhen(E2eSelection.IsExcluded(TestContext.Current),
            "not selected by the e2e-impact manifest");
        _backend = FirebaseEmulatorBackend.Create(Configuration);
        Assert.SkipWhen(_backend is null,
            "MOBILE_FIREBASE_EMULATOR is unset — this run provides no Firebase emulator backend.");
        // The suite declares an emulator for this run — a refusal here is an
        // infrastructure failure, not a skippable absence.
        await _backend!.AccountsAsync();
        // Disposable-backend hygiene starts clean too: no residue can predate
        // the scenario's first assertion about users/{uid}.
        await _backend.WipeDatabaseAsync();
        if (Configuration.Platform == MobilePlatform.Android)
        {
            // A marker left by an earlier scenario would bind this launch to
            // the emulator; the local-first half needs the channel absent.
            AndroidDeviceBridge.RemoveEmulatorMarker();
            _launcherComponent = AndroidDeviceBridge.LauncherComponent();
        }
        await base.InitializeAsync();
    }

    public override async ValueTask DisposeAsync()
    {
        if (Configuration.Platform == MobilePlatform.Android)
        {
            // The marker file survives process restarts by design; without
            // this removal the next scenario's app would stay emulator-bound.
            AndroidDeviceBridge.RemoveEmulatorMarker();
        }
        if (_backend != null)
        {
            try
            {
                await _backend.WipeDatabaseAsync();
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException)
            {
                // A dead emulator cannot leak data — cleanup failure is noted,
                // never reported as the scenario's own outcome.
                Output.WriteLine($"Firebase emulator wipe failed during cleanup: {exception.Message}");
            }
            _backend.Dispose();
        }
        await base.DisposeAsync();
    }

    [Fact]
    public void SilentAnonymousSyncPersistsPreferencesAcrossRelaunch() =>
        Scenario(() => SyncAcrossRelaunchAsync().GetAwaiter().GetResult());

    [Fact]
    public void OfflineWritesStayLocalAndSyncAfterEndpointRecovery() =>
        Scenario(() => OfflineSyncAsync().GetAwaiter().GetResult());

    private async Task SyncAcrossRelaunchAsync()
    {
        // A preference written while the app is still local-only must become
        // the cloud truth on the first merge — existing local state survives
        // the feature's arrival (#1095's migration decision).
        var toggled = ToggleDivineNameMasking();
        LaunchWithEndpoint(_backend!.DeviceEndpoint(Configuration.Platform));

        // Silent anonymous auth: no consent, account picker or error dialog —
        // the only observable effect is the committed document.
        var uid = await WaitForAnonymousUserAsync();
        AssertNoBlockingDialog();

        var document = await _backend.WaitForUserDocumentAsync(uid, doc =>
            EntryBool(doc, SyncedToggleKey) == toggled);
        var fields = document.RootElement.GetProperty("fields");
        Assert.Equal("1", fields.GetProperty("schemaVersion").GetProperty("integerValue").GetString());
        Assert.False(string.IsNullOrWhiteSpace(
            fields.GetProperty("deviceId").GetProperty("stringValue").GetString()));

        // An entry a newer app version could have written must pass through
        // this build's merge untouched — it survives the next save verbatim.
        const string unknownKey = "vNextUnknownKey";
        await _backend.InjectEntryAsync(uid, unknownKey);
        toggled = ToggleDivineNameMasking();
        document = await _backend.WaitForUserDocumentAsync(uid, doc =>
            EntryBool(doc, SyncedToggleKey) == toggled);
        Assert.True(
            FirebaseEmulatorBackend.TryGetEntry(document, unknownKey, out var injected)
                && FirebaseEmulatorBackend.TryReadValue(injected, out var injectedValue)
                && injectedValue.GetProperty("stringValue").GetString() == "future-key-payload",
            $"the merge dropped the unknown entry: {document.RootElement.GetRawText()}");

        // Per-user isolation: unauthenticated reads and another signed-in
        // identity are both denied by the deployed rules.
        Assert.Equal(HttpStatusCode.Forbidden, await _backend.ReadStatusAsync(uid, null));
        var strangerToken = await _backend.SignUpAnonymousAsync();
        Assert.Equal(HttpStatusCode.Forbidden, await _backend.ReadStatusAsync(uid, strangerToken));

        // Relaunch with the same installation identity: the restart resolves
        // the endpoint through the persisted channel, the restored anonymous
        // session keeps the same uid, and the document stays whole.
        RelaunchKeepingChannel();
        AssertNoBlockingDialog();
        Assert.Equal(new[] { uid }, await _backend.UserDocumentIdsAsync());
        document = await _backend.UserDocumentAsync(uid);
        Assert.NotNull(document);
        Assert.True(FirebaseEmulatorBackend.TryGetEntry(document, unknownKey, out _),
            "the relaunched merge rewrote users/{uid} without the carried-through entry");
    }

    private async Task OfflineSyncAsync()
    {
        LaunchWithEndpoint(_backend!.DeviceEndpoint(Configuration.Platform));
        var uid = await WaitForAnonymousUserAsync();

        // Offline: auth and store are both unreachable. The app must save
        // locally and stay silent — no sign-in prompt, no error dialog.
        LaunchWithEndpoint(DeadEndpoint());
        AssertNoBlockingDialog();
        var toggled = ToggleDivineNameMasking();
        AssertNoBlockingDialog();

        // The local write persisted immediately even with the backend dead.
        if (Configuration.Platform == MobilePlatform.Android)
        {
            var preferences = AndroidDeviceBridge.SharedPreferencesDump();
            Assert.True(preferences?.Contains(SyncedToggleKey) == true,
                "the offline preference write never reached local storage");
        }
        // The committed document must not show the new value while the
        // endpoint is unreachable — bounded negative watch, not an
        // unconditional pass.
        await AssertEntryDoesNotBecomeAsync(uid, SyncedToggleKey, toggled, TimeSpan.FromSeconds(8));

        // Recovery: the same install resolves the live endpoint again, the
        // restored identity syncs the queued local change, and no second
        // user document appears.
        LaunchWithEndpoint(_backend.DeviceEndpoint(Configuration.Platform));
        await _backend.WaitForUserDocumentAsync(uid, doc =>
            EntryBool(doc, SyncedToggleKey) == toggled);
        Assert.Equal(new[] { uid }, await _backend.UserDocumentIdsAsync());
        AssertNoBlockingDialog();
    }

    /// <summary>A preference toggle through the real flyout navigation, ending
    /// back on the reader. Returns the value the switch now holds — what the
    /// cloud document must eventually mirror.</summary>
    private bool ToggleDivineNameMasking()
    {
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Page.Tap("SettingsDisplayRow");
        var toggle = Page.WaitFor("DivineNameMaskingSwitch");
        var previous = Platform.IsChecked(toggle);
        Platform.Tap(Driver!, toggle);
        Page.WaitFor("DivineNameMaskingSwitch", element => Platform.IsChecked(element) == !previous);
        // Restore the reader so the next restart/lookup starts at a known page.
        Platform.GoBack(Driver!);
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSource", element => !string.IsNullOrWhiteSpace(element.Text));
        return !previous;
    }

    private void LaunchWithEndpoint(string deviceEndpoint)
    {
        if (Configuration.Platform == MobilePlatform.Android)
        {
            Driver!.TerminateApp(Platform.AppId);
            // The intent extra is the app's persisted-channel entry point —
            // MainActivity records it for every later activateApp relaunch.
            AndroidDeviceBridge.StartWithEmulatorEndpoint(_launcherComponent!, deviceEndpoint);
            MobilePlatformAdapter.EnsurePortrait(Driver!);
        }
        else
        {
            Platform.RestartApp(Driver!, EmulatorEnvironment(deviceEndpoint));
        }
        Page.WaitForStartup();
    }

    private void RelaunchKeepingChannel()
    {
        if (Configuration.Platform == MobilePlatform.Android)
        {
            // activateApp drops intent extras; the marker file MainActivity
            // persisted is what this relaunch actually exercises.
            Platform.RestartApp(Driver!, null);
        }
        else
        {
            // iOS launchApp re-declares its full environment, so the endpoint
            // rides again — the env channel is the stable one there.
            Platform.RestartApp(Driver!, EmulatorEnvironment(_backend!.DeviceEndpoint(MobilePlatform.IOS)));
        }
        Page.WaitForStartup();
    }

    private static IReadOnlyDictionary<string, string> EmulatorEnvironment(string endpoint) =>
        new Dictionary<string, string>
        {
            [BibleOnSite.Services.FirebaseEmulatorEndpoint.EnvironmentVariable] = endpoint
        };

    private string DeadEndpoint() =>
        $"{_backend!.DeviceHost(Configuration.Platform)}:{DeadAuthPort}:{DeadFirestorePort}";

    /// <summary>Resolves the signed-in uid and asserts its backend account is
    /// a silent anonymous identity. The provider check proves first-time
    /// sign-in only in whichever scenario runs first — the backend starts
    /// account-free, so that scenario's uid is necessarily a fresh account
    /// this run created. A later scenario's uid is the persisted install
    /// identity it already proved; there the check still runs as a
    /// regression, and the identity's survival across the relaunch is what
    /// the scenario asserts separately.</summary>
    private async Task<string> WaitForAnonymousUserAsync()
    {
        var preexisting = (await _backend!.AccountsAsync())
            .Select(user => user.GetProperty("localId").GetString())
            .ToHashSet(StringComparer.Ordinal);
        var uid = await WaitForSingleUserAsync();
        var account = Assert.Single(await _backend.AccountsAsync(),
            user => user.GetProperty("localId").GetString() == uid);
        // Anonymous sessions carry no providerUserInfo — anything else would
        // be a real (prompted) login flow, which the feature must never open.
        var providerInfo = account.TryGetProperty("providerUserInfo", out var providers)
            ? providers.GetRawText() : "[]";
        Assert.True(providerInfo is "[]" or "null",
            $"users/{uid} should belong to an anonymous identity but lists providers {providerInfo}");
        Output.WriteLine(preexisting.Contains(uid)
            ? $"install identity {uid} reused — first-time sign-in was proven by the earlier scenario"
            : $"fresh silent anonymous sign-in created {uid}");
        return uid;
    }

    private async Task<string> WaitForSingleUserAsync()
    {
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (true)
        {
            var ids = await _backend!.UserDocumentIdsAsync();
            if (ids.Count == 1)
            {
                return ids[0];
            }
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException(
                    $"no single users/{{uid}} document appeared on the emulator; ids observed: [{string.Join(", ", ids)}]");
            }
            await Task.Delay(400);
        }
    }

    private static bool? EntryBool(JsonDocument? document, string key)
    {
        if (!FirebaseEmulatorBackend.TryGetEntry(document, key, out var entry)
            || !FirebaseEmulatorBackend.TryReadValue(entry, out var value)
            || !value.TryGetProperty("booleanValue", out var boolean))
        {
            return null;
        }
        return boolean.GetBoolean();
    }

    private async Task AssertEntryDoesNotBecomeAsync(string uid, string key, bool forbidden, TimeSpan window)
    {
        var deadline = DateTime.UtcNow.Add(window);
        while (DateTime.UtcNow < deadline)
        {
            var observed = EntryBool(await _backend!.UserDocumentAsync(uid), key);
            Assert.NotEqual(forbidden, observed);
            await Task.Delay(400);
        }
    }

    private void AssertNoBlockingDialog()
    {
        if (Configuration.Platform != MobilePlatform.Android)
        {
            // iOS auto-accepts system alerts for the session; the startup
            // wait that reached the reader is the functional evidence there.
            return;
        }
        var source = Driver!.PageSource;
        Assert.DoesNotContain("android:id/alertTitle", source);
        Assert.DoesNotContain("permissioncontroller", source);
    }
}
