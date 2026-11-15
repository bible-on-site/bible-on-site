using BibleOnSite.Services;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Tests.Services;

public class CopyrightReportTests
{
    private static readonly Uri ReportUri = new("mailto:tanah.site@gmail.com");

    [Fact]
    public async Task OpensReportingAddressWithoutAnAlertWhenSuccessful()
    {
        var launcher = new Mock<ILauncher>(MockBehavior.Strict);
        launcher.Setup(l => l.OpenAsync(ReportUri)).ReturnsAsync(true);
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);

        await CopyrightReport.OpenEmailAsync(launcher.Object, navigator.Object);

        launcher.Verify(l => l.OpenAsync(ReportUri), Times.Once);
        navigator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task ShowsReportingAddressWhenLauncherReturnsFalse()
    {
        var launcher = new Mock<ILauncher>(MockBehavior.Strict);
        launcher.Setup(l => l.OpenAsync(ReportUri)).ReturnsAsync(false);
        var navigator = FailureNavigator();

        await CopyrightReport.OpenEmailAsync(launcher.Object, navigator.Object);

        navigator.Verify(n => n.DisplayAlertAsync("שגיאה",
            It.Is<string>(message => message.Contains("tanah.site@gmail.com")), "אישור"), Times.Once);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task ShowsReportingAddressForExpectedLauncherFailures(int failure)
    {
        Exception error = failure switch
        {
            0 => new FeatureNotSupportedException(),
            1 => new InvalidOperationException(),
            2 => new UriFormatException(),
            _ => new ArgumentException(),
        };
        var launcher = new Mock<ILauncher>(MockBehavior.Strict);
        launcher.Setup(l => l.OpenAsync(ReportUri)).ThrowsAsync(error);
        var navigator = FailureNavigator();

        await CopyrightReport.OpenEmailAsync(launcher.Object, navigator.Object);

        navigator.Verify(n => n.DisplayAlertAsync("שגיאה",
            It.Is<string>(message => message.Contains("tanah.site@gmail.com")), "אישור"), Times.Once);
    }

    [Fact]
    public async Task PropagatesUnexpectedFailures()
    {
        var error = new NotImplementedException();
        var launcher = new Mock<ILauncher>(MockBehavior.Strict);
        launcher.Setup(l => l.OpenAsync(ReportUri)).ThrowsAsync(error);
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);

        var thrown = await Assert.ThrowsAsync<NotImplementedException>(
            () => CopyrightReport.OpenEmailAsync(launcher.Object, navigator.Object));

        Assert.Same(error, thrown);
        navigator.VerifyNoOtherCalls();
    }

    private static Mock<IAppNavigator> FailureNavigator()
    {
        var navigator = new Mock<IAppNavigator>(MockBehavior.Strict);
        navigator.Setup(n => n.DisplayAlertAsync("שגיאה",
            It.Is<string>(message => message.Contains("tanah.site@gmail.com")), "אישור"))
            .Returns(Task.CompletedTask);
        return navigator;
    }
}
