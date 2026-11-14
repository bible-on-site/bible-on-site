using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The watch that owns Back presses during a Navigating→Navigated settle
/// window (#2460/#2926).
/// </summary>
public class NavigationSettleWatchTests
{
    private static readonly Uri Reader = new("//reader", UriKind.Relative);
    private static readonly Uri Preferences = new("//reader/PreferencesPage", UriKind.Relative);
    private static readonly DateTimeOffset Now = new(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void OwnsBack_WithoutAnyNavigation_ReturnsFalse()
    {
        new NavigationSettleWatch().OwnsBack(Now).Should().BeFalse();
    }

    [Fact]
    public void OwnsBack_AfterLocationChangingProposal_ReturnsTrue()
    {
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.OwnsBack(Now).Should().BeTrue("a real transition owns Back presses until Navigated arrives");
    }

    [Fact]
    public void Begin_SameLocationProposal_DoesNotArm()
    {
        // #2926: the packs shortcut leaves a PreferencesPage entry on top and the
        // flyout's העדפות entry targets that same location — such proposals never
        // report Navigated, so arming here would consume Back forever.
        var watch = new NavigationSettleWatch();
        watch.Begin(Preferences, Preferences, Now);
        watch.OwnsBack(Now).Should().BeFalse("same-location proposals never complete a settle window");
    }

    [Fact]
    public void Begin_SameLocationProposal_DoesNotDisarmAPendingTransition()
    {
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.Begin(Preferences, Preferences, Now);
        watch.OwnsBack(Now).Should().BeTrue("a no-op proposal must not cancel the real in-flight window");
    }

    [Fact]
    public void OwnsBack_AfterNavigated_ReturnsFalse()
    {
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.Complete();
        watch.OwnsBack(Now).Should().BeFalse();
    }

    [Fact]
    public void OwnsBack_AfterConsumeBound_ReleasesThePipeline()
    {
        // A navigation that never reports Navigated (cancelled, faulted or a
        // stalled platform transition) must not lock Back for good (#2926).
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.OwnsBack(Now + NavigationSettleWatch.ConsumeBound).Should().BeFalse();
    }

    [Fact]
    public void OwnsBack_JustInsideConsumeBound_StillConsumes()
    {
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.OwnsBack(Now + NavigationSettleWatch.ConsumeBound - TimeSpan.FromMilliseconds(1))
            .Should().BeTrue();
    }

    [Fact]
    public void Begin_RepeatedProposal_RestartsTheWindow()
    {
        var watch = new NavigationSettleWatch();
        watch.Begin(Reader, Preferences, Now);
        watch.Begin(Reader, Preferences, Now + TimeSpan.FromSeconds(1.5));
        watch.OwnsBack(Now + NavigationSettleWatch.ConsumeBound)
            .Should().BeTrue("the newer proposal owns its own settle window");
    }
}
