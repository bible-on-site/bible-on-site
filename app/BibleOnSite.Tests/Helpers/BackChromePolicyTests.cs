using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Helpers;

/// <summary>Back/Up visibility policy (#2467).</summary>
public class BackChromePolicyTests
{
    [Fact]
    public void AndroidPlatformDefaultHidesTheInAppButton()
    {
        BackChromePolicy.ShowInAppBack(BackChromePlatform.Android,
            InAppBackButtonPreference.PlatformDefault).Should().BeFalse();
    }

    [Fact]
    public void AndroidShowOverrideDisplaysTheInAppButton()
    {
        BackChromePolicy.ShowInAppBack(BackChromePlatform.Android,
            InAppBackButtonPreference.Show).Should().BeTrue();
    }

    [Fact]
    public void AndroidHideOverrideHidesTheInAppButton()
    {
        BackChromePolicy.ShowInAppBack(BackChromePlatform.Android,
            InAppBackButtonPreference.Hide).Should().BeFalse();
    }

    [Theory]
    [InlineData(BackChromePlatform.Apple)]
    [InlineData(BackChromePlatform.Windows)]
    [InlineData(BackChromePlatform.Other)]
    public void NonAndroidPlatformsAlwaysShowAndIgnoreTheOverride(BackChromePlatform platform)
    {
        foreach (var preference in Enum.GetValues<InAppBackButtonPreference>())
        {
            BackChromePolicy.ShowInAppBack(platform, preference).Should().BeTrue(
                $"the Android override must not leak into {platform} (pref={preference})");
        }
    }

    [Fact]
    public void NavBarBackIsNeverShownAtARootDestination()
    {
        // Up is navigation history only — never an app-exit button — even on
        // platforms and overrides that show the affordance.
        foreach (var platform in Enum.GetValues<BackChromePlatform>())
        {
            foreach (var preference in Enum.GetValues<InAppBackButtonPreference>())
            {
                BackChromePolicy.ShowNavBarBack(false, platform, preference).Should().BeFalse();
            }
        }
    }

    [Fact]
    public void CapsuleBack_NeverShowsOnWindows()
    {
        // Windows Back lives exclusively in the window title bar — an
        // in-content capsule button would be a second Windows Back (#2467).
        foreach (var preference in Enum.GetValues<InAppBackButtonPreference>())
        {
            BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Windows, preference)
                .Should().BeFalse($"the title bar owns Windows Back (pref={preference})");
        }
    }

    [Fact]
    public void CapsuleBack_FollowsTheInAppPolicyElsewhere()
    {
        BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Apple,
            InAppBackButtonPreference.PlatformDefault).Should().BeTrue();
        BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Apple,
            InAppBackButtonPreference.Hide).Should().BeTrue(
                "the Android override never leaks into iOS chrome");
        BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Android,
            InAppBackButtonPreference.Show).Should().BeTrue();
        BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Android,
            InAppBackButtonPreference.PlatformDefault).Should().BeFalse();
        BackChromePolicy.ShowCapsuleBack(BackChromePlatform.Android,
            InAppBackButtonPreference.Hide).Should().BeFalse();
    }

    [Fact]
    public void NavBarBackOnPushedPagesFollowsThePolicy()
    {
        BackChromePolicy.ShowNavBarBack(true, BackChromePlatform.Apple,
            InAppBackButtonPreference.PlatformDefault).Should().BeTrue();
        BackChromePolicy.ShowNavBarBack(true, BackChromePlatform.Android,
            InAppBackButtonPreference.Show).Should().BeTrue();
        BackChromePolicy.ShowNavBarBack(true, BackChromePlatform.Android,
            InAppBackButtonPreference.PlatformDefault).Should().BeFalse();
        BackChromePolicy.ShowNavBarBack(true, BackChromePlatform.Android,
            InAppBackButtonPreference.Hide).Should().BeFalse();
    }
}
