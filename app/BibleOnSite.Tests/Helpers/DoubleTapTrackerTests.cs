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
    public void AudioChannelPreferences_DefaultToFull_AndPersistIndependently()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        preferences.Load();
        preferences.RecitationVolume.Should().Be(1);
        preferences.LessonsVolume.Should().Be(1);
        preferences.EffectsVolume.Should().Be(1);
        preferences.RecitationVolume = 0.2;
        preferences.LessonsVolume = 0.5;
        preferences.EffectsVolume = 0.8;
        var restored = PreferencesService.CreateForTesting(storage);
        restored.Load();
        restored.RecitationVolume.Should().Be(0.2);
        restored.LessonsVolume.Should().Be(0.5);
        restored.EffectsVolume.Should().Be(0.8);
        restored.FontFactor.Should().Be(1);
        restored.RecitationVolume = 1;
        preferences.Load(); preferences.RecitationVolume.Should().Be(1);
    }

[Fact]
    public void Tap_AfterDoubleTapWindow_IsNotARapidTap()
    {
        var tracker = new DoubleTapTracker();

        tracker.Tap(203, 1, 0).Should().BeFalse();
        tracker.Tap(203, 1, 351).Should().BeFalse("351ms exceeds the rapid-tap window");
    }
}
