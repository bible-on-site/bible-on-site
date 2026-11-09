using System.Net;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// #3185: native Firestore preference persistence verified end to end against
// the local Firebase Emulator Suite. These scenarios run only when the app
// was built with -p:FirebaseEmulator=true (FIREBASE_EMULATOR=1 reaches
// CompileMobileE2E) and FIREBASE_EMULATOR=1 is set for the test process —
// production and ordinary e2e builds never compile the emulator path, so the
// silent local-first contract stays exactly as shipped: no consent, login,
// account-selection or permission prompt may ever appear.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class FirebasePreferencesSyncTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    // Synced preference keys (PreferencesService storage names — the same
    // strings the cloud document's entries map uses).
    private const string PerekToLoadKey = "perekToLoad";
    private const string QriynotKey = "qriynotEnabled";

    public override async ValueTask InitializeAsync()
    {
        Assert.SkipWhen(!FirebaseEmulatorProbe.Enabled,
            "FIREBASE_EMULATOR=1 is not set — these scenarios need the emulator-gated app build and a running suite.");
        await FirebaseEmulatorProbe.RequireAliveAsync();
        await base.InitializeAsync();
    }

    [Fact]
    public void SilentAnonymousSignIn_CreatesUserDocument_WithoutPrompts() => Scenario(() =>
    {
        // The suite launch already ran PreferencesSyncService.StartAsync:
        // anonymous sign-in, then the first fetch/merge/write round.
        var uid = WaitForAppUser();
        var docJson = WaitForDocument(uid);
        using var document = JsonDocument.Parse(docJson);
        var fields = document.RootElement.GetProperty("fields");
        Assert.Equal("1", fields.GetProperty("schemaVersion").GetProperty("integerValue").GetString());
        Assert.False(string.IsNullOrEmpty(
            fields.GetProperty("deviceId").GetProperty("stringValue").GetString()));
        Assert.True(fields.TryGetProperty("entries", out _), "users/{uid} must carry the entries map.");
        // The silent contract: no consent, login, account or permission UI.
        Assert.Empty(Driver!.FindElements(Platform.AutomationId("AppDialogCard")));
        Assert.Empty(Driver!.FindElements(Platform.AutomationId("AppDialogTitle")));
        Output.WriteLine($"users/{uid} created by silent anonymous sign-in; no prompts shown.");
    });

    [Fact]
    public void PreferenceEdit_WritesSyncedEntryThroughNativeAdapter() => Scenario(() =>
    {
        var uid = WaitForAppUser();
        WaitForDocument(uid);
        OpenPerekPreferences();
        // perekToLoad is a synced integer (0=Todays, 1=LastLearnt) whose option
        // cards sit at the top of the page — no scroll needed. Read the remote
        // truth, flip to the other value, and require the emulator document to
        // converge: proof the write passed through the real native adapter.
        var before = FirebaseEmulatorProbe.GetEntryAsync(uid, PerekToLoadKey).GetAwaiter().GetResult();
        var current = before.Present && !before.Tombstone ? Convert.ToInt64(before.Value) : 0L;
        var expected = current == 1 ? 0L : 1L;
        Page.Tap(current == 1 ? "PerekTodaysOption" : "PerekLastLearntOption");
        FirebaseEmulatorProbe
            .WaitForEntryValueAsync(uid, PerekToLoadKey, expected, TimeSpan.FromSeconds(60))
            .GetAwaiter().GetResult();
        Output.WriteLine($"perekToLoad synced {current} -> {expected} on users/{uid}.");
    });

    [Fact]
    public void Relaunch_AppliesRemoteWinner_AndKeepsIdentity() => Scenario(() =>
    {
        var uid = WaitForAppUser();
        WaitForDocument(uid);
        OpenPerekPreferences();
        var switchBefore = EnsureVisible("QriynotEnabledSwitch");
        var localBefore = Platform.IsChecked(switchBefore);
        // Another device writes the opposite value, stamped newer than anything
        // local — the next merge must apply it as the remote winner.
        var remoteValue = !localBefore;
        FirebaseEmulatorProbe.WriteEntryAsync(
                uid, QriynotKey, remoteValue,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 60_000)
            .GetAwaiter().GetResult();

        Platform.RestartApp(Driver!, null);
        Page.WaitForStartup();

        // Same anonymous identity — the relaunch neither re-prompted nor
        // minted a second account.
        Assert.Equal(uid, FirebaseEmulatorProbe.AppUserIdAsync().GetAwaiter().GetResult());

        // The remote winner reached local state: the switch now shows the
        // value the "other device" wrote, proving the cloud document drives
        // preferences across relaunches.
        OpenPerekPreferences();
        Assert.True(WaitForQriynotState(remoteValue, TimeSpan.FromSeconds(45)),
            $"qriynotEnabled did not converge to the remote value {remoteValue} after relaunch.");
        // Identity kept — checked after sync settles: AppUserIdAsync resolves
        // the OLDEST account holding a document, so a re-minted identity would
        // still report the original uid while the app silently switched
        // accounts. Exactly one Auth account and one users/{uid} document must
        // remain for the equality above to mean "same identity".
        Assert.Equal(new[] { uid }, FirebaseEmulatorProbe.ListUserIdsAsync().GetAwaiter().GetResult());
        Assert.Single(FirebaseEmulatorProbe.ListAccountsAsync().GetAwaiter().GetResult());
        Assert.Empty(Driver!.FindElements(Platform.AutomationId("AppDialogCard")));
    });

    [Fact]
    public void OfflineSave_RemainsLocal_AndSyncsAfterRecovery() => Scenario(() =>
    {
        var uid = WaitForAppUser();
        WaitForDocument(uid);
        OpenPerekPreferences();
        var switchBefore = EnsureVisible("QriynotEnabledSwitch");
        var localBefore = Platform.IsChecked(switchBefore);
        var offlineValue = !localBefore;

        // Pin the remote entry to the local value first: without this the
        // "remote must not move" probe can collide with a stale remote value
        // that already equals offlineValue (a failed earlier scenario leaves
        // the doc diverged on purpose). A past stamp keeps the app's own
        // merge free to re-stamp it — only the VALUE needs to match.
        FirebaseEmulatorProbe.WriteEntryAsync(
                uid, QriynotKey, localBefore,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000)
            .GetAwaiter().GetResult();

        var recovered = false;
        try
        {
            // One process lifetime with Auth+Firestore pointed at a dead endpoint:
            // iOS gets it as launch environment, Android as system properties.
            FirebaseEmulatorDeviceControl.RestartOffline(Driver!, Platform, Configuration);
            Page.WaitForStartup();

            // The preference still toggles and persists locally while offline.
            OpenPerekPreferences();
            var offlineSwitch = EnsureVisible("QriynotEnabledSwitch");
            Assert.True(Platform.IsChecked(offlineSwitch) == localBefore,
                "The synced preference must survive the offline relaunch locally.");
            var remoteBefore = FirebaseEmulatorProbe.GetEntryAsync(uid, QriynotKey).GetAwaiter().GetResult();
            Platform.Tap(Driver!, offlineSwitch);

            // Observation window, not a sleep-to-pass: the debounced sync (2s) plus
            // a write attempt must land well inside it if the endpoint override
            // ever leaked. Comparing the whole snapshot — not just the value —
            // keeps the check honest even if the remote already held offlineValue.
            Thread.Sleep(8000);
            var during = FirebaseEmulatorProbe.GetEntryAsync(uid, QriynotKey).GetAwaiter().GetResult();
            Assert.True(during.Present == remoteBefore.Present
                && during.Tombstone == remoteBefore.Tombstone
                && during.UpdatedAtMs == remoteBefore.UpdatedAtMs
                && Equals(during.Value, remoteBefore.Value),
                $"The offline write reached the Emulator Suite (entries.{QriynotKey} moved while the endpoint was dead) — the dead-endpoint override did not apply.");

            // Connectivity "returns": the next launch's sync converges the queued
            // local change into the cloud document.
            FirebaseEmulatorDeviceControl.RestartRecovered(Driver!, Platform, Configuration);
            recovered = true;
            Page.WaitForStartup();
            FirebaseEmulatorProbe
                .WaitForEntryValueAsync(uid, QriynotKey, offlineValue, TimeSpan.FromSeconds(60))
                .GetAwaiter().GetResult();
            OpenPerekPreferences();
            Assert.True(WaitForQriynotState(offlineValue, TimeSpan.FromSeconds(30)),
                "The offline-saved preference did not survive recovery locally.");
            Assert.Empty(Driver!.FindElements(Platform.AutomationId("AppDialogCard")));
        }
        finally
        {
            // A failed assertion must not leave the device pointed at the dead
            // endpoint — later scenarios in the shared session would inherit it.
            if (!recovered)
            {
                try
                {
                    FirebaseEmulatorDeviceControl.RestartRecovered(Driver!, Platform, Configuration);
                }
                catch (Exception exception)
                {
                    Output.WriteLine($"endpoint restore after offline scenario failed: {exception.Message}");
                }
            }
        }
    });

    [Fact]
    public void Sync_PreservesUnrelatedDocumentEntries() => Scenario(() =>
    {
        var uid = WaitForAppUser();
        WaitForDocument(uid);
        var marker = $"probe-{Guid.NewGuid():N}";
        // Foreign state the app must never drop: an unknown entries.* key a
        // newer app version might own, plus a top-level field outside the
        // synced schema entirely.
        FirebaseEmulatorProbe.InjectUnrelatedFieldsAsync(uid, marker).GetAwaiter().GetResult();

        // Force a real merge write through the native adapter.
        OpenPerekPreferences();
        var before = FirebaseEmulatorProbe.GetEntryAsync(uid, PerekToLoadKey).GetAwaiter().GetResult();
        var current = before.Present && !before.Tombstone ? Convert.ToInt64(before.Value) : 0L;
        var expected = current == 1 ? 0L : 1L;
        Page.Tap(current == 1 ? "PerekTodaysOption" : "PerekLastLearntOption");
        FirebaseEmulatorProbe
            .WaitForEntryValueAsync(uid, PerekToLoadKey, expected, TimeSpan.FromSeconds(60))
            .GetAwaiter().GetResult();

        var json = FirebaseEmulatorProbe.GetUserDocumentJsonAsync(uid).GetAwaiter().GetResult()
            ?? throw new InvalidOperationException($"users/{uid} disappeared after the merge write.");
        using var document = JsonDocument.Parse(json);
        var fields = document.RootElement.GetProperty("fields");
        Assert.Equal(marker,
            fields.GetProperty("unrelatedField").GetProperty("stringValue").GetString());
        var probeEntry = fields.GetProperty("entries")
            .GetProperty("mapValue").GetProperty("fields")
            .GetProperty("emulatorProbeKey")
            .GetProperty("mapValue").GetProperty("fields")
            .GetProperty("value").GetProperty("stringValue").GetString();
        Assert.Equal(marker, probeEntry);
    });

    [Fact]
    public void SecurityRules_ScopeDocumentsToTheirOwner() => Scenario(() =>
    {
        var appUid = WaitForAppUser();
        WaitForDocument(appUid);
        var (otherUid, otherToken) = FirebaseEmulatorProbe.SignUpAnonymousAsync().GetAwaiter().GetResult();
        try
        {
            // A second identity may create and read only its own document —
            // the rules' request.auth.uid == userId contract on the emulator.
            FirebaseEmulatorProbe.CreateUserDocumentAsync(otherUid, otherToken, "isolation")
                .GetAwaiter().GetResult();
            var ownStatus = FirebaseEmulatorProbe
                .GetUserDocumentStatusAsync(otherUid, otherToken).GetAwaiter().GetResult();
            Assert.Equal(HttpStatusCode.OK, ownStatus);

            var foreignStatus = FirebaseEmulatorProbe
                .GetUserDocumentStatusAsync(appUid, otherToken).GetAwaiter().GetResult();
            Assert.True((int)foreignStatus >= 400,
                $"users/{{appUid}} must deny a different authenticated user; got {foreignStatus}.");

            var anonymousStatus = FirebaseEmulatorProbe
                .GetUserDocumentStatusAsync(appUid, bearer: null).GetAwaiter().GetResult();
            Assert.True((int)anonymousStatus >= 400,
                $"users/{{appUid}} must deny unauthenticated reads; got {anonymousStatus}.");

            // And the app user's document carries none of the other identity's data.
            var appJson = FirebaseEmulatorProbe.GetUserDocumentJsonAsync(appUid).GetAwaiter().GetResult();
            Assert.DoesNotContain("emulatorIsolationProbe", appJson ?? string.Empty);
        }
        finally
        {
            // Disposable identities/documents: the emulator is in-memory, but
            // cleaning up keeps a long-lived local suite deterministic too.
            try { FirebaseEmulatorProbe.DeleteUserDocumentAsync(otherUid).GetAwaiter().GetResult(); }
            catch (Exception exception) { Output.WriteLine($"probe doc cleanup: {exception.Message}"); }
            try { FirebaseEmulatorProbe.DeleteAccountAsync(otherToken).GetAwaiter().GetResult(); }
            catch (Exception exception) { Output.WriteLine($"probe account cleanup: {exception.Message}"); }
        }
    });

    // ── helpers ──────────────────────────────────────────────────────────

    private void OpenPerekPreferences()
    {
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Page.WaitFor("SettingsPerekRow");
        Page.Tap("SettingsPerekRow");
        Page.WaitFor("PerekTodaysOption");
    }

    /// <summary>
    /// The preferences page is a ScrollView: controls below the fold exist in
    /// the tree but fail the viewport check, so WaitFor alone never sees them.
    /// Swipe up until the target's center is on screen.
    /// </summary>
    private AppiumElement EnsureVisible(string automationId)
    {
        for (var attempt = 0; attempt < 6; attempt++)
        {
            try
            {
                return Page.WaitFor(automationId, _ => true, TimeSpan.FromSeconds(4));
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                SwipeContentUp();
            }
        }
        return Page.WaitFor(automationId);
    }

    private void SwipeContentUp()
    {
        var window = DriverTelemetry.WindowSize(Driver!);
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        var x = window.Width / 2;
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, (int)(window.Height * 0.75), TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, (int)(window.Height * 0.3), TimeSpan.FromMilliseconds(400)));
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        Driver!.PerformActions([sequence]);
    }

    /// <summary>
    /// Polls the switch until it reports <paramref name="expected"/> — the
    /// remote-winner apply runs inside the fire-and-forget startup sync, so
    /// the first read after relaunch can legitimately precede it.
    /// </summary>
    private bool WaitForQriynotState(bool expected, TimeSpan timeout)
    {
        // Bring the switch into the viewport once; later polls re-find it.
        EnsureVisible("QriynotEnabledSwitch");
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var element = Page.WaitFor("QriynotEnabledSwitch", _ => true, TimeSpan.FromSeconds(5));
                if (Platform.IsChecked(element) == expected)
                {
                    return true;
                }
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // Still navigating or mid-apply; the next poll re-reads.
            }
            catch (StaleElementReferenceException)
            {
                // The page re-rendered between lookup and read.
            }
            Thread.Sleep(500);
        }
        return false;
    }

    private string WaitForAppUser()
    {
        var deadline = DateTime.UtcNow.Add(TimeSpan.FromSeconds(45));
        while (true)
        {
            try
            {
                return FirebaseEmulatorProbe.AppUserIdAsync().GetAwaiter().GetResult();
            }
            catch (InvalidOperationException) when (DateTime.UtcNow < deadline)
            {
                Thread.Sleep(1000);
            }
        }
    }

    private string WaitForDocument(string uid)
    {
        var deadline = DateTime.UtcNow.Add(TimeSpan.FromSeconds(45));
        while (DateTime.UtcNow < deadline)
        {
            var json = FirebaseEmulatorProbe.GetUserDocumentJsonAsync(uid).GetAwaiter().GetResult();
            if (json != null)
            {
                return json;
            }
            Thread.Sleep(1000);
        }
        throw new TimeoutException($"users/{uid} was not created in the Emulator Suite within 45s.");
    }
}
