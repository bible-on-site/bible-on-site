using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Collection follows informed continued use or a settings grant. The e2e
/// marker always overrides either state, keeping production reports clean.
/// </summary>
public class AnalyticsConsentTests
{
    [Fact]
    public void Consent_DefaultsOff_WhenNothingStored()
    {
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.IsGranted(storage).Should().BeFalse();
        AnalyticsConsent.WasAsked(storage).Should().BeFalse();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeFalse();
    }

    [Fact]
    public void Consent_Grant_PersistsAndEnablesCollection()
    {
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.Save(storage, true);
        storage.Get(AnalyticsConsent.StorageKey, "").Should().Be("granted");
        AnalyticsConsent.IsGranted(storage).Should().BeTrue();
        AnalyticsConsent.WasAsked(storage).Should().BeTrue();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeTrue();
    }

    [Fact]
    public void Consent_Denial_PersistsAndKeepsCollectionOff()
    {
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.Save(storage, false);
        storage.Get(AnalyticsConsent.StorageKey, "").Should().Be("denied");
        AnalyticsConsent.IsGranted(storage).Should().BeFalse();
        AnalyticsConsent.WasAsked(storage).Should().BeTrue();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeFalse();
    }

    [Fact]
    public void Consent_E2eMarkedProcess_ForcesCollectionOff_EvenWhenGranted()
    {
        // The e2e isolation contract (#2120) outranks a stored opt-in: a
        // previous non-suite install on the same device must not leak suite
        // traffic into the production property.
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.Save(storage, true);
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: true).Should().BeFalse();
    }

    [Fact]
    public void Consent_E2eEnvironmentVariable_ForcesCollectionOff_EvenWhenGranted()
    {
        // Same override through the launch-time public overload, whose e2e
        // probe short-circuits on BIBLE_E2E without touching the filesystem
        // (the plain test host has no FileSystem.AppDataDirectory).
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.Save(storage, true);
        var previous = Environment.GetEnvironmentVariable(SearchIndexService.E2eEnvironmentVariable);
        Environment.SetEnvironmentVariable(SearchIndexService.E2eEnvironmentVariable, "1");
        try
        {
            AnalyticsConsent.IsCollectionEnabled(storage).Should().BeFalse();
        }
        finally
        {
            Environment.SetEnvironmentVariable(SearchIndexService.E2eEnvironmentVariable, previous);
        }
    }

    [Fact]
    public void Consent_UnsetOrGarbageStorage_CountsAsNeverAsked()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set(AnalyticsConsent.StorageKey, "junk");
        AnalyticsConsent.IsGranted(storage).Should().BeFalse();
        AnalyticsConsent.WasAsked(storage).Should().BeFalse();
    }

    [Fact]
    public void PreferencesService_AnalyticsConsent_DefaultsOffAndSurvivesRestart()
    {
        var storage = new InMemoryPreferencesStorage();
        var service = PreferencesService.CreateForTesting(storage);
        service.Load();
        service.AnalyticsConsentAsked.Should().BeFalse("the entry disclosure is still due");
        service.AnalyticsConsentEnabled.Should().BeFalse("collection waits for informed continued use or a settings grant");

        service.SetAnalyticsConsent(true);
        service.AnalyticsConsentAsked.Should().BeTrue();
        service.AnalyticsConsentEnabled.Should().BeTrue();

        var restored = PreferencesService.CreateForTesting(storage);
        restored.Load();
        restored.AnalyticsConsentAsked.Should().BeTrue();
        restored.AnalyticsConsentEnabled.Should().BeTrue("the stored opt-in survives a restart");

        restored.SetAnalyticsConsent(false);
        restored.AnalyticsConsentEnabled.Should().BeFalse();
    }

    [Fact]
    public void PreferencesService_SetAnalyticsConsent_SameValue_IsANoOp()
    {
        var storage = new InMemoryPreferencesStorage();
        var service = PreferencesService.CreateForTesting(storage);
        service.Load();
        service.SetAnalyticsConsent(true);
        var changes = 0;
        service.PreferencesChanged += (_, _) => changes++;

        service.SetAnalyticsConsent(true);

        changes.Should().Be(0, "re-applying the stored answer must not re-notify");
    }

    [Fact]
    public void ContinuedUse_RequiresTheNoticeToHaveBeenShown()
    {
        var storage = new InMemoryPreferencesStorage();

        AnalyticsConsent.RecordContinuedUse(storage, noticeShown: false).Should().BeFalse();

        AnalyticsConsent.WasAsked(storage).Should().BeFalse();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeFalse();
    }

    [Fact]
    public void ContinuedUse_EnablesMeasurementWithoutRecordingAnExplicitGrant()
    {
        var storage = new InMemoryPreferencesStorage();

        AnalyticsConsent.RecordContinuedUse(storage, noticeShown: true).Should().BeTrue();

        storage.Get(AnalyticsConsent.StorageKey, "").Should().Be(AnalyticsConsent.ContinuedUseValue);
        AnalyticsConsent.IsGranted(storage).Should().BeFalse();
        AnalyticsConsent.WasAsked(storage).Should().BeTrue();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeTrue();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: true).Should().BeFalse();
        AnalyticsConsent.RecordContinuedUse(storage, noticeShown: true).Should().BeFalse();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ContinuedUse_PreservesChoicesMadeUnderTheNewScheme(bool granted)
    {
        var storage = new InMemoryPreferencesStorage();
        AnalyticsConsent.Save(storage, granted);

        AnalyticsConsent.RecordContinuedUse(storage, noticeShown: true).Should().BeFalse();

        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().Be(granted);
        storage.Get(AnalyticsConsent.StorageKey, "").Should().Be(granted ? "granted" : "denied");
    }

    [Theory]
    [InlineData("granted")]
    [InlineData("denied")]
    public void RetiredLaunchDialogPreference_IsIgnored(string oldChoice)
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("analyticsConsent", oldChoice);
        var service = PreferencesService.CreateForTesting(storage);
        service.Load();

        service.AnalyticsConsentAsked.Should().BeFalse();
        service.AnalyticsConsentEnabled.Should().BeFalse();
        AnalyticsConsent.IsCollectionEnabled(storage, e2eMarked: false).Should().BeFalse();

        service.RecordAnalyticsContinuedUse(noticeShown: true);
        service.AnalyticsConsentEnabled.Should().BeTrue();
    }

    [Fact]
    public void PreferencesService_ContinuedUse_NotifiesOnceAndSurvivesRestart()
    {
        var storage = new InMemoryPreferencesStorage();
        var service = PreferencesService.CreateForTesting(storage);
        service.Load();
        var changes = 0;
        service.PreferencesChanged += (_, _) => changes++;

        service.RecordAnalyticsContinuedUse(noticeShown: false);
        changes.Should().Be(0);
        service.RecordAnalyticsContinuedUse(noticeShown: true);
        service.AnalyticsConsentAsked.Should().BeTrue();
        service.AnalyticsConsentEnabled.Should().BeTrue();
        changes.Should().Be(1);
        service.RecordAnalyticsContinuedUse(noticeShown: true);
        changes.Should().Be(1);

        var restored = PreferencesService.CreateForTesting(storage);
        restored.Load();
        restored.AnalyticsConsentAsked.Should().BeTrue();
        restored.AnalyticsConsentEnabled.Should().BeTrue();
        restored.SetAnalyticsConsent(false);
        restored.RecordAnalyticsContinuedUse(noticeShown: true);
        restored.AnalyticsConsentEnabled.Should().BeFalse();
    }
}
