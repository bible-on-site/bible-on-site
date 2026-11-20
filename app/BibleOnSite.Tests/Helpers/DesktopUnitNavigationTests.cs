using BibleOnSite.Helpers;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// PgUp/PgDn unit stepping shared by the four readers (#2766): a transient
/// surface that owns Back also owns unit stepping, and a command that
/// cannot run (corpus edge) leaves the key unhandled.
/// </summary>
public class DesktopUnitNavigationTests
{
    [Fact]
    public void TryStep_SurfaceOwnsInput_NeverSteps()
    {
        var stepped = false;
        var next = new Command(() => stepped = true);

        foreach (var owner in Enum.GetValues<ReaderBackSurface>().Where(s => s != ReaderBackSurface.None))
        {
            DesktopUnitNavigation.TryStep(owner, next, next, 1).Should().BeFalse(
                $"{owner} owns input — PgDn must not navigate the unit out from under it");
        }

        stepped.Should().BeFalse();
    }

    [Fact]
    public void TryStep_ClearSurface_NextRunsOnPositiveDirection()
    {
        var nextRan = false;
        var previousRan = false;

        DesktopUnitNavigation.TryStep(ReaderBackSurface.None,
            new Command(() => nextRan = true), new Command(() => previousRan = true), 1)
            .Should().BeTrue();

        nextRan.Should().BeTrue();
        previousRan.Should().BeFalse();
    }

    [Fact]
    public void TryStep_ClearSurface_PreviousRunsOnNegativeDirection()
    {
        var nextRan = false;
        var previousRan = false;

        DesktopUnitNavigation.TryStep(ReaderBackSurface.None,
            new Command(() => nextRan = true), new Command(() => previousRan = true), -1)
            .Should().BeTrue();

        previousRan.Should().BeTrue();
        nextRan.Should().BeFalse();
    }

    [Fact]
    public void TryStep_CommandCannotRun_LeavesKeyUnhandled()
    {
        // At the corpus edge CanGoToNext/Previous is false — the press stays
        // unhandled so nothing pretends a step happened.
        var next = new Command(() => { }, () => false);

        DesktopUnitNavigation.TryStep(ReaderBackSurface.None, next, next, 1)
            .Should().BeFalse();
    }

    [Fact]
    public void TryStep_NullCommand_LeavesKeyUnhandled()
    {
        DesktopUnitNavigation.TryStep(ReaderBackSurface.None, null, null, 1)
            .Should().BeFalse();
    }
}
