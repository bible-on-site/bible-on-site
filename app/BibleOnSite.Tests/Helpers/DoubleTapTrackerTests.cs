using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Helpers;

public class DoubleTapTrackerTests
{
    [Fact]
    public void RapidTapRequiresSameChapterAndVerse_ResetsAfterDoubleTap()
    {
        var tracker = new DoubleTapTracker();
        tracker.Tap(203, 1, 0).Should().BeFalse();
        tracker.Tap(203, 1, 200).Should().BeTrue();
        tracker.Tap(203, 1, 250).Should().BeFalse();
        tracker.Tap(203, 2, 300).Should().BeFalse();
        tracker.Tap(204, 2, 320).Should().BeFalse();
        tracker.Tap(204, 2, 900).Should().BeFalse();
        tracker.Tap(204, 2, 899).Should().BeFalse("a regressing clock cannot qualify as a rapid second tap");
        tracker.Reset();
        tracker.Tap(204, 2, 950).Should().BeFalse();
    }

    [Fact]
    public void RecitationPreferenceIsOffByDefault_AndPersistsIndependently()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        preferences.RecitationEnabled.Should().BeFalse();
        preferences.RecitationEnabled = true;
        var restored = PreferencesService.CreateForTesting(storage);
        restored.Load();
        restored.RecitationEnabled.Should().BeTrue();
        restored.FontFactor.Should().Be(1);
        restored.RecitationEnabled = false;
        preferences.Load(); preferences.RecitationEnabled.Should().BeFalse();
    }
}
