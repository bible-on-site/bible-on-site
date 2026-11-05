using BibleOnSite.Config;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.ApplicationModel;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// עלון יומי join cards (#2806, links #2942): exactly the website's three
/// public channels — Telegram, WhatsApp and email — bound to the stable
/// first-party /bulletin/{channel}/join routes, launching through ILauncher and
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
    public void Cards_ExposeOnlyTheStableFirstPartyJoinRoutes()
    {
        var (vm, _, _) = Subject();

        // Joining surfaces only the website's stable first-party routes —
        // the admin-managed destinations resolve behind them server-side
        // (#2942). Never raw provider invitations, private test destinations
        // or credentials.
        var site = AppConfig.Instance.WebsiteUrl;
        site.Should().Be("https://xn--febl3a.com");
        vm.Cards.Select(card => card.JoinUri.AbsoluteUri).Should().Equal(
            $"{site}/bulletin/telegram/join",
            $"{site}/bulletin/whatsapp/join",
            $"{site}/bulletin/email/join");
    }

    [Fact]
    public void Cards_JoinRoutesAreCleanAbsoluteHttpsUris()
    {
        var (vm, _, _) = Subject();

        // No query, fragment or credentials may ride along on the stable
        // route — parameters belong to the server-side destination, which
        // must stay changeable without an app release.
        vm.Cards.Should().OnlyContain(card =>
            card.JoinUri.IsAbsoluteUri
            && card.JoinUri.Scheme == "https"
            && card.JoinUri.Host == new Uri(AppConfig.Instance.WebsiteUrl).Host
            && string.IsNullOrEmpty(card.JoinUri.UserInfo)
            && string.IsNullOrEmpty(card.JoinUri.Query)
            && string.IsNullOrEmpty(card.JoinUri.Fragment));
    }

    [Fact]
    public void Cards_MirrorTheWebsiteJoinCardCopy()
    {
        var (vm, _, _) = Subject();

        // Titles, join labels and order match the website carousel (#2941).
        vm.Cards.Select(card => card.Title).Should().Equal(
            "טלגרם", "ווטסאפ", "דוא\"ל");
        vm.Cards.Select(card => card.JoinLabel).Should().Equal(
            "הצטרפות לערוץ", "הצטרפות לקבוצה", "הרשמה");
    }

    [Fact]
    public async Task JoinTelegram_OpensTheStableJoinRoute()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[0]);

        opened().Should().Be(new Uri($"{AppConfig.Instance.WebsiteUrl}/bulletin/telegram/join"));
    }

    [Fact]
    public async Task JoinWhatsApp_OpensTheStableJoinRoute_NotARawInvitation()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[1]);

        opened().Should().Be(new Uri($"{AppConfig.Instance.WebsiteUrl}/bulletin/whatsapp/join"));
        // The rotating chat.whatsapp.com invitation must never ship in the
        // app — only the admin-managed destination behind
        // /bulletin/whatsapp/join.
        opened()!.Host.Should().Be(new Uri(AppConfig.Instance.WebsiteUrl).Host);
    }

    [Fact]
    public async Task JoinEmail_OpensTheSharedSignupPage_NotMailto()
    {
        var launcher = LauncherCapturing(out var opened);
        var vm = new DailyBulletinViewModel(launcher.Object, new Mock<IAppNavigator>().Object);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[2]);

        opened()!.Scheme.Should().Be("https");
        opened().Should().Be(new Uri($"{AppConfig.Instance.WebsiteUrl}/bulletin/email/join"));
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
            "שגיאה", "לא ניתן לפתוח את קישור הטלגרם. נסו שוב", "אישור"), Times.Once);
    }

    [Fact]
    public async Task JoinCommand_WhenLauncherReportsUnavailable_AlertsInsteadOfFailingSilently()
    {
        var (vm, _, navigator) = Subject(launcherResult: false);

        await vm.JoinCommand.ExecuteAsync(vm.Cards[2]);

        navigator.Verify(n => n.DisplayAlertAsync(
            "שגיאה", "לא ניתן לפתוח את דף ההרשמה. נסו שוב", "אישור"), Times.Once);
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
