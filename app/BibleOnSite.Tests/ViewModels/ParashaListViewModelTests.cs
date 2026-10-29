using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

public class ParashaListViewModelTests
{
    [Fact]
    public async Task OpenParasha_WhenNavigationFails_SwallowAndLog()
    {
        await using var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).ThrowsAsync(new IOException("route unavailable"));
        var vm = new ParashaListViewModel(
            new ParashaDataService(localDb), new PerekDataService(localDb), navigator.Object);
        var unit = new ParashaUnit
        {
            UnitId = 1, Slug = "בראשית", SeferName = "בראשית", Heading = "בראשית",
            TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 1, EndPerekId = 1, EndPasuk = 10 }
        };

        await vm.OpenParashaCommand.ExecuteAsync(unit);

        navigator.Verify(n => n.GoToAsync("ParashaPage?unitId=1"), Times.Once);
    }
}
