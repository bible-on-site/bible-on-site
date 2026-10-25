using BibleOnSite.Services;
using Moq;

namespace BibleOnSite.Tests.Services;

public class PreferencesNavigationTests
{
    [Fact]
    public async Task PerushimShortcut_EntersPreferencesAtPacks_AsOneHistoryEntry()
    {
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).Returns(Task.CompletedTask);

        await PreferencesNavigation.OpenPerushimDownloadAsync(navigator.Object);

        navigator.Verify(n => n.GoToAsync("PreferencesPage?section=packs"), Times.Once);
        navigator.VerifyNoOtherCalls();
    }
}
