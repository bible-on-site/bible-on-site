using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// עלון יומי join carousel (#2806): the three public bulletin channels —
/// Telegram, WhatsApp and email — in the website's card order. Cards launch
/// the external app through <see cref="ILauncher"/> and surface an in-app
/// alert when the destination is unavailable or the launch fails.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class DailyBulletinViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly ILauncher _launcher;
    private readonly IAppNavigator _navigator;

    public DailyBulletinViewModel()
        : this(Launcher.Default, ShellAppNavigator.Instance)
    {
    }

    public DailyBulletinViewModel(ILauncher launcher, IAppNavigator navigator)
    {
        _launcher = launcher;
        _navigator = navigator;
    }

    /// <summary>The three join cards; bound both to the carousel and the indicator.</summary>
    public IReadOnlyList<BulletinJoinCard> Cards => BulletinJoinCards.All;

    /// <summary>The focused card — synced two-way with the carousel/indicator.</summary>
    [ObservableProperty]
    private int _position;

    /// <summary>
    /// Opens the card's public join destination. A failed or unavailable
    /// launch shows the card's Hebrew failure message rather than failing
    /// silently (#2806).
    /// </summary>
    [RelayCommand]
    public async Task JoinAsync(BulletinJoinCard? card)
    {
        if (card is null)
        {
            return;
        }

        try
        {
            var opened = await _launcher.OpenAsync(card.JoinUri);
            if (!opened)
            {
                await _navigator.DisplayAlertAsync("שגיאה", card.FailureMessage, "אישור");
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: launcher failure alerts the user
        catch (Exception ex) //NOSONAR — launcher failure alerts the user.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error opening bulletin join link ({card.Key}): {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", card.FailureMessage, "אישור");
        }
    }
}
