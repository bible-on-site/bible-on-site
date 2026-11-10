using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Moq;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Regression: picking a hamburger-menu item used to swap the Shell root ("//AuthorsPage"),
/// leaving the menu page with no back stack and no way back to the perek page.
/// </summary>
[Collection("Application state")]
public class FlyoutNavigationTests
{
    private sealed class TestApplication(Page page) : Application
    {
        protected override Window CreateWindow(IActivationState? activationState)
        {
            _ = activationState;
            return new Window(page);
        }
    }

    private sealed class PerekReaderStub : ContentPage;
    private sealed class AuthorsStub : ContentPage;
    private sealed class TosStub : ContentPage;
    private sealed class SearchReaderStub : ContentPage;
    private sealed class ParashaListStub : ContentPage;
    private sealed class ParashaReaderStub : ContentPage;
    private sealed class MasoraReaderStub : ContentPage;
    private sealed class CalendarReaderStub : ContentPage;
    private sealed class LearningCalendarStub : ContentPage;
    private sealed class ArticleDetailStub : ContentPage;
    private sealed class PreferencesStub : ContentPage;

    private static async Task<Shell> WithShellAsync(Func<Shell, Task> body)
    {
        var previous = Application.Current;
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>())).Returns((Action action) => { action(); return true; });
        var provider = new Mock<IDispatcherProvider>();
        provider.Setup(p => p.GetForCurrentThread()).Returns(dispatcher.Object);
        DispatcherProvider.SetCurrent(provider.Object);
        try
        {
            Routing.RegisterRoute("FlyoutTestAuthors", typeof(AuthorsStub));
            Routing.RegisterRoute("FlyoutTestTos", typeof(TosStub));
            Routing.RegisterRoute(AppRoutes.SearchReader, typeof(SearchReaderStub));
            Routing.RegisterRoute(AppRoutes.ParashaList, typeof(ParashaListStub));
            Routing.RegisterRoute(AppRoutes.Parasha, typeof(ParashaReaderStub));
            Routing.RegisterRoute(AppRoutes.Masora, typeof(MasoraReaderStub));
            Routing.RegisterRoute(AppRoutes.CalendarReader, typeof(CalendarReaderStub));
            Routing.RegisterRoute(AppRoutes.LearningCalendar, typeof(LearningCalendarStub));
            Routing.RegisterRoute(AppRoutes.ArticleDetail, typeof(ArticleDetailStub));
            Routing.RegisterRoute(AppRoutes.Preferences, typeof(PreferencesStub));
            var shell = new Shell();
            shell.Items.Add(new ShellContent { Route = AppRoutes.Perek, Content = new PerekReaderStub() });
            var application = new TestApplication(shell);
            Application.Current = application;
            ((IApplication)application).CreateWindow(null!);
            await shell.GoToAsync($"//{AppRoutes.Perek}");
            await body(shell);
            return shell;
        }
        finally
        {
            Routing.UnRegisterRoute("FlyoutTestAuthors");
            Routing.UnRegisterRoute("FlyoutTestTos");
            Routing.UnRegisterRoute(AppRoutes.SearchReader);
            Routing.UnRegisterRoute(AppRoutes.ParashaList);
            Routing.UnRegisterRoute(AppRoutes.Parasha);
            Routing.UnRegisterRoute(AppRoutes.Masora);
            Routing.UnRegisterRoute(AppRoutes.CalendarReader);
            Routing.UnRegisterRoute(AppRoutes.LearningCalendar);
            Routing.UnRegisterRoute(AppRoutes.ArticleDetail);
            Routing.UnRegisterRoute(AppRoutes.Preferences);
            Application.Current = previous;
            DispatcherProvider.SetCurrent(null);
        }
    }

    [Fact]
    public async Task FlyoutPage_IsPushedAbovePerek_AndBackReturnsToPerek()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));

            shell.Navigation.NavigationStack.Should().HaveCount(2);
            shell.CurrentPage.Should().BeOfType<AuthorsStub>();

            await shell.GoToAsync("..");

            shell.Navigation.NavigationStack.Should().HaveCount(1);
            shell.CurrentState.Location.OriginalString.Should().Be($"//{AppRoutes.Perek}");
        });
    }

    [Fact]
    public async Task FlyoutPage_FromAnotherFlyoutPage_ReplacesItInsteadOfStacking()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestTos"));

            shell.Navigation.NavigationStack.Should().HaveCount(2);
            shell.CurrentPage.Should().BeOfType<TosStub>();
        });
    }

    [Fact]
    public async Task FlyoutPage_ForPerek_PopsBackToPerek()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors"));
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek));

            shell.Navigation.NavigationStack.Should().HaveCount(1);
            shell.CurrentState.Location.OriginalString.Should().Be($"//{AppRoutes.Perek}");
        });
    }

    [Fact]
    public async Task FlyoutPage_AfterSearchJump_PreservesBothReaderAndSearchHistory()
    {
        await WithShellAsync(async shell =>
        {
            var original = shell.CurrentPage;
            await shell.GoToAsync(AppRoutes.SearchReader);
            var reader = shell.CurrentPage;
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestAuthors", shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync(AppRoutes.FlyoutPage("FlyoutTestTos", shell.CurrentState.Location.OriginalString));
            shell.Navigation.NavigationStack.Should().HaveCount(3);
            shell.CurrentPage.Should().BeOfType<TosStub>();
            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(reader);
            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(original);
        });
    }

    [Theory]
    [InlineData("//PerekPage/searchReader/searchReader/PreferencesPage?source=x", "//PerekPage/searchReader/searchReader")]
    [InlineData("//unknown/PreferencesPage", "//PerekPage")]
    public void FlyoutPage_ForReader_PreservesTheLatestReaderPath(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Perek, location).Should().Be(expected);
    }

    #region Reader-destination identity (#3263)

    /// <summary>
    /// The reported four-step flow (#3263): על הפרק → פרשה על הפרק → בראשית →
    /// על הפרק. The final menu action must activate an actual perek reader —
    /// not reselect the parasha reader the location happened to end on.
    /// </summary>
    [Fact]
    public async Task FlyoutPage_ForPerek_FromParashaReader_ActivatesThePerekReader()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.ParashaList, shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync($"{AppRoutes.Parasha}?unitId=1");
            shell.CurrentPage.Should().BeOfType<ParashaReaderStub>();

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek, shell.CurrentState.Location.OriginalString));

            shell.CurrentPage.Should().BeOfType<PerekReaderStub>(
                "choosing על הפרק activates the perek division — the parasha reader must not satisfy it");
            shell.Navigation.NavigationStack.Should().ContainSingle();
            shell.CurrentState.Location.OriginalString.Should().Be($"//{AppRoutes.Perek}");
        });
    }

    /// <summary>The masora reader is a different division — same transition family.</summary>
    [Fact]
    public async Task FlyoutPage_ForPerek_FromMasoraReader_ActivatesThePerekReader()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Masora, shell.CurrentState.Location.OriginalString));
            shell.CurrentPage.Should().BeOfType<MasoraReaderStub>();

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek, shell.CurrentState.Location.OriginalString));

            shell.CurrentPage.Should().BeOfType<PerekReaderStub>();
            shell.Navigation.NavigationStack.Should().ContainSingle();
        });
    }

    /// <summary>A menu page pushed above a foreign reader must not decide the
    /// destination — the requested division still wins.</summary>
    [Fact]
    public async Task FlyoutPage_ForPerek_AboveDetailPageOnParasha_ActivatesThePerekReader()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.ParashaList, shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync($"{AppRoutes.Parasha}?unitId=1");
            await shell.GoToAsync($"{AppRoutes.ArticleDetail}?articleId=9");
            shell.CurrentPage.Should().BeOfType<ArticleDetailStub>();

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek, shell.CurrentState.Location.OriginalString));

            shell.CurrentPage.Should().BeOfType<PerekReaderStub>();
            shell.Navigation.NavigationStack.Should().ContainSingle();
        });
    }

    /// <summary>Reselecting the active division's own destination is a safe
    /// no-op — it must not stack a duplicate reader page.</summary>
    [Fact]
    public async Task FlyoutPage_ForParasha_OnParashaReader_DoesNotStackADuplicate()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.ParashaList, shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync($"{AppRoutes.Parasha}?unitId=1");
            var stack = shell.Navigation.NavigationStack.Count;

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Parasha, shell.CurrentState.Location.OriginalString));

            shell.Navigation.NavigationStack.Should().HaveCount(stack);
            shell.CurrentPage.Should().BeOfType<ParashaReaderStub>();
        });
    }

    /// <summary>A reader of another division stays beneath a menu page, so
    /// Back returns to the reading — the masora/calendar readers anchor menu
    /// pushes exactly like the perek and parasha readers always did.</summary>
    [Fact]
    public async Task FlyoutPage_MenuPage_AboveMasoraReader_BackReturnsToMasora()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Masora, shell.CurrentState.Location.OriginalString));
            var masora = shell.CurrentPage.Should().BeOfType<MasoraReaderStub>().Subject;

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Preferences, shell.CurrentState.Location.OriginalString));
            shell.CurrentPage.Should().BeOfType<PreferencesStub>();

            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(masora);
        });
    }

    /// <summary>Same protection for the calendar's perek reader instance —
    /// the calendar + reader history stays under the menu page.</summary>
    [Fact]
    public async Task FlyoutPage_MenuPage_AboveCalendarReader_BackReturnsThroughTheCalendar()
    {
        await WithShellAsync(async shell =>
        {
            await shell.GoToAsync($"{AppRoutes.LearningCalendar}");
            await shell.GoToAsync($"{AppRoutes.CalendarReader}?perekId=2");
            var reader = shell.CurrentPage.Should().BeOfType<CalendarReaderStub>().Subject;

            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Preferences, shell.CurrentState.Location.OriginalString));
            shell.CurrentPage.Should().BeOfType<PreferencesStub>();

            await shell.GoToAsync("..");
            shell.CurrentPage.Should().BeSameAs(reader);

            // Choosing על הפרק here lands on that same perek-division reader —
            // it is already the requested division's instance.
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Preferences, shell.CurrentState.Location.OriginalString));
            await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek, shell.CurrentState.Location.OriginalString));
            shell.CurrentPage.Should().BeSameAs(reader);
        });
    }

    /// <summary>
    /// Every registered reader route and its division — the matrix consumes
    /// the shared route-role map so a new reader family (e.g. מועדים) joins
    /// the transition coverage automatically instead of falling out of it.
    /// </summary>
    public static IEnumerable<object[]> ReaderRoutes =>
        AppRoutes.ReaderDivisions.Select(entry => new object[] { entry.Key, entry.Value });

    [Theory]
    [MemberData(nameof(ReaderRoutes))]
    public void ReaderRoutes_StayClassifiedInExactlyOneDivision(string route, ReaderDivision division)
    {
        AppRoutes.ReaderDivisions.Should().ContainKey(route);
        division.Should().BeOneOf(ReaderDivision.Perek, ReaderDivision.Parasha, ReaderDivision.Masora);
        // Reader destinations highlight a real flyout row — the selected-state
        // code derives it from the same map, never a second hardcoded list.
        BibleOnSite.ViewModels.FlyoutMenuState.DestinationFor(route).Should().NotBe(BibleOnSite.ViewModels.FlyoutDestination.None);
    }

    [Theory]
    // על הפרק chooses the perek division — a foreign reader never satisfies it.
    [InlineData("//PerekPage/ParashaListPage/ParashaPage?unitId=1", "//PerekPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage?unitId=27", "//PerekPage")]
    [InlineData("//PerekPage/MasoraPage?unitId=2", "//PerekPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage/articleDetail?articleId=9", "//PerekPage")]
    [InlineData("//PerekPage/MasoraPage/PreferencesPage", "//PerekPage")]
    // The parasha listing is not a reader — the perek root beneath it is.
    [InlineData("//PerekPage/ParashaListPage", "//PerekPage")]
    // Same-division instances keep their running history.
    [InlineData("//PerekPage", "//PerekPage")]
    [InlineData("//PerekPage?perekId=5", "//PerekPage")]
    [InlineData("//PerekPage/searchReader?perekId=5", "//PerekPage/searchReader")]
    [InlineData("//PerekPage/searchReader/searchReader/PreferencesPage?source=x", "//PerekPage/searchReader/searchReader")]
    [InlineData("//PerekPage/LearningCalendarPage/calendarReader?perekId=2&date=2026-01-01", "//PerekPage/LearningCalendarPage/calendarReader")]
    [InlineData("//PerekPage/LearningCalendarPage/calendarReader/PreferencesPage", "//PerekPage/LearningCalendarPage/calendarReader")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage/searchReader?perekId=3", "//PerekPage/ParashaListPage/ParashaPage/searchReader")]
    [InlineData("//unknown/PreferencesPage", "//PerekPage")]
    public void FlyoutPage_ForPerek_ActivatesThePerekDivision(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Perek, location).Should().Be(expected);
    }

    [Theory]
    // A running masora reader is returned to — pages above it pop.
    [InlineData("//PerekPage/MasoraPage", "//PerekPage/MasoraPage")]
    [InlineData("//PerekPage/MasoraPage?unitId=2", "//PerekPage/MasoraPage")]
    [InlineData("//PerekPage/MasoraPage/articleDetail?articleId=9", "//PerekPage/MasoraPage")]
    [InlineData("//PerekPage/MasoraPage/PreferencesPage", "//PerekPage/MasoraPage")]
    // From a foreign division the masora reader opens above the current
    // reader so Back still returns to it.
    [InlineData("//PerekPage", "//PerekPage/MasoraPage")]
    [InlineData("//PerekPage/searchReader?perekId=5", "//PerekPage/searchReader/MasoraPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage?unitId=1", "//PerekPage/ParashaListPage/ParashaPage/MasoraPage")]
    [InlineData("//PerekPage/LearningCalendarPage/calendarReader?perekId=2", "//PerekPage/LearningCalendarPage/calendarReader/MasoraPage")]
    [InlineData("//unknown/PreferencesPage", "//PerekPage/MasoraPage")]
    public void FlyoutPage_ForMasora_ActivatesTheMasoraDivision(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Masora, location).Should().Be(expected);
    }

    [Theory]
    // Same-division reselects return to the running reader — never a second
    // parasha instance stacked above itself or above a pushed page.
    [InlineData("//PerekPage/ParashaListPage/ParashaPage?unitId=1", "//PerekPage/ParashaListPage/ParashaPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage/PreferencesPage", "//PerekPage/ParashaListPage/ParashaPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage/articleDetail?articleId=9", "//PerekPage/ParashaListPage/ParashaPage")]
    public void FlyoutPage_ForParasha_ActivatesTheParashaDivision(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Parasha, location).Should().Be(expected);
    }

    [Theory]
    // Menu pages stack above the deepest live reader of any division, so
    // Back returns to the reading — the masora and calendar readers anchor
    // this path too (#3263 family).
    [InlineData("//PerekPage/MasoraPage", "//PerekPage/MasoraPage/PreferencesPage")]
    [InlineData("//PerekPage/LearningCalendarPage/calendarReader?perekId=2", "//PerekPage/LearningCalendarPage/calendarReader/PreferencesPage")]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage?unitId=1", "//PerekPage/ParashaListPage/ParashaPage/PreferencesPage")]
    [InlineData("//PerekPage/searchReader?perekId=5", "//PerekPage/searchReader/PreferencesPage")]
    // A non-reader destination (the parasha listing) is replaced like any
    // other menu page — it does not anchor history the way a reader does.
    [InlineData("//PerekPage/ParashaListPage", "//PerekPage/PreferencesPage")]
    [InlineData("//unknown", "//PerekPage/PreferencesPage")]
    public void FlyoutPage_MenuPage_StacksAboveTheCurrentReader(string location, string expected)
    {
        AppRoutes.FlyoutPage(AppRoutes.Preferences, location).Should().Be(expected);
    }

    [Theory]
    // Reselecting the active destination recomputes the current location —
    // a safe no-op, never stack growth.
    [InlineData("PerekPage", "//PerekPage")]
    [InlineData("MasoraPage", "//PerekPage/MasoraPage")]
    [InlineData("ParashaPage", "//PerekPage/ParashaListPage/ParashaPage")]
    [InlineData("ParashaListPage", "//PerekPage/ParashaListPage")]
    [InlineData("PreferencesPage", "//PerekPage/PreferencesPage")]
    public void FlyoutPage_ReselectingTheCurrentDestination_StaysPut(string route, string location)
    {
        AppRoutes.FlyoutPage(route, location).Should().Be(location);
    }

    #endregion
}
