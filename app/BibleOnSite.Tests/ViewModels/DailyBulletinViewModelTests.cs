using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.ApplicationModel;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// עלון יומי join carousel (#2806): exactly the website's three public
/// channels — Telegram, WhatsApp and email — launching through ILauncher and
/// surfacing failures visibly.
/// </summary>
public class DailyBulletinViewModelTests
{
    private static Mock<ILauncher> LauncherCapturing(out Func<Uri?> opened, bool result = true)
    {
        Uri? captured = null;
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>()))
            .Callback<Uri>(u => captured = u)
            .ReturnsAsync(result);
        opened = () => captured;
        return launcher;
    }

    private static (DailyBulletinViewModel vm, Mock<ILauncher> launcher, Mock<IAppNavigator> navigator) Subject(
        bool launcherResult = true)
    {
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>())).ReturnsAsync(launcherResult);
        var navigator = new Mock<IAppNavigator>();
        return (new DailyBulletinViewModel(launcher.Object, navigator.Object), launcher, navigator);
    }

    [Fact]
    public void Cards_AreExactlyTheThreePublicChannels_InWebsiteOrder()
    {
        var (vm, _, _) = Subject();

        vm.Cards.Should().HaveCount(3);
        vm.Cards.Select(card => card.Key).Should().Equal(
            BulletinJoinCards.TelegramKey,
            BulletinJoinCards.WhatsAppKey,
            BulletinJoinCards.EmailKey);
    }

    [Fact]
    public void DefaultConstructor_WiresThePlatformLauncherAndShellNavigator()
    {
        var vm = new DailyBulletinViewModel();

        vm.Cards.Should().HaveCount(3);
    }

    [Fact]
    public void Cards_ParseBrandColorsForTheCardChrome()
    {
        var (vm, _, _) = Subject();

        vm.Cards.Should().OnlyContain(card => card.BrandColor != null);
    }

    [Fact]
    public void Cards_ExposeOnlyPublicDestinations()
    {
        var (vm, _, _) = Subject();

        // Joining must surface only public channels — never private test
        // groups, test destination IDs or provider credentials (#2806).
        vm.Cards.Should().OnlyContain(card => card.JoinUri.IsAbsoluteUri);
        vm.Cards.Should().OnlyContain(card =>
            card.JoinUri.Scheme == "https" || card.JoinUri.Scheme == "mailto");
        vm.Cards.Select(card => card.JoinUri.AbsoluteUri).Should().SatisfyRespectively(
            uri => uri.Should().StartWith("https://t.me/alhaperek"),
            uri => uri.Should().StartWith("https://wa.me/37257078640"),
            uri => uri.Should().StartWith("mailto:tanah.site@gmail.com"));
    }

    [Fact]
    public async Task JoinTelegram_OpensTheVerifiedPublicChannel()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[0]);

        opened().Should().Be(new Uri("https://t.me/alhaperek"));
    }

    [Fact]
    public async Task JoinWhatsApp_OpensThePublicJoinNumber_WithJoinText()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[1]);

        opened()!.Scheme.Should().Be("https");
        opened()!.Host.Should().Be("wa.me");
        opened()!.AbsoluteUri.Should().Contain(Uri.EscapeDataString("הצטרפות לעלון היומי"));
    }

    [Fact]
    public async Task JoinEmail_OpensMailTo_WithJoinSubject()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[2]);

        opened()!.Scheme.Should().Be("mailto");
        opened()!.AbsoluteUri.Should().Contain("tanah.site@gmail.com");
        opened()!.AbsoluteUri.Should().Contain(Uri.EscapeDataString("הצטרפות לעלון היומי"));
    }

    [Fact]
    public async Task JoinCommand_WithNullCard_DoesNothing()
    {
        var (vm, launcher, navigator) = Subject();

        await vm.JoinCommand.ExecuteAsync(null);

        launcher.Verify(l => l.OpenAsync(It.IsAny<Uri>()), Times.Never);
        navigator.Verify(n => n.DisplayAlertAsync(
            It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task JoinCommand_WhenLauncherThrows_AlertsTheCardFailureMessage()
    {
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>())).ThrowsAsync(new InvalidOperationException("no app"));
        var navigator = new Mock<IAppNavigator>();
        var vm = new DailyBulletinViewModel(launcher.Object, navigator.Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[0]);

        navigator.Verify(n => n.DisplayAlertAsync(
            "שגיאה", "לא ניתן לפתוח את טלגרם. נסו שוב", "אישור"), Times.Once);
    }

    [Fact]
    public async Task JoinCommand_WhenLauncherReportsUnavailable_AlertsInsteadOfFailingSilently()
    {
        var (vm, _, navigator) = Subject(launcherResult: false);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[2]);

        navigator.Verify(n => n.DisplayAlertAsync(
            "שגיאה", "לא ניתן לפתוח את אפליקציית הדואר. נסו שוב", "אישור"), Times.Once);
    }

    [Theory]
    [InlineData("whatsapp", 1)]
    [InlineData("telegram", 0)]
    [InlineData("email", 2)]
    [InlineData("WHATSAPP", 1)]
    [InlineData("unknown", 0)]
    [InlineData(null, 0)]
    public void PositionForKey_MapsChannelKeysToCardPositions(string? key, int expected)
    {
        BulletinJoinCards.PositionForKey(key).Should().Be(expected);
    }

    [Fact]
    public void AutomationIds_AreUniquePerCard()
    {
        BulletinJoinCards.All.Select(card => card.AutomationId).Should().OnlyHaveUniqueItems();
    }
}
