using BibleOnSite.Services;
using Microsoft.Maui.Storage;

namespace BibleOnSite.Tests.Services;

public class MauiPreferencesStorageTests
{
    [Fact]
    public void Adapter_ForwardsTypedReadsWritesAndRemovalsToDeviceStorage()
    {
        var preferences = new Mock<IPreferences>();
        preferences.Setup(p => p.Get("font", 1.0, null)).Returns(1.5);
        var storage = new MauiPreferencesStorage(preferences.Object);
        storage.Get("font", 1.0).Should().Be(1.5);
        storage.Set("font", 1.75);
        storage.Remove("font");
        preferences.Verify(p => p.Set("font", 1.75, null), Times.Once);
        preferences.Verify(p => p.Remove("font", null), Times.Once);
    }
}
