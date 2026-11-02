using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// עלון יומי (#2806): the daily-bulletin join cards mirroring the website's
/// public join surface — Telegram, WhatsApp and email. Supports the
/// ?channel= deep link, which scrolls the matching card into view.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration and controls.
public partial class DailyBulletinPage : ContentPage, IQueryAttributable
#pragma warning restore S2333
{
    private readonly DailyBulletinViewModel _viewModel;
    private int? _pendingCardIndex;

    public DailyBulletinPage()
    {
        InitializeComponent();
        _viewModel = new DailyBulletinViewModel();
        BindingContext = _viewModel;
    }

    /// <summary>
    /// ?channel=whatsapp (and friends) reveals the matching card. Before the
    /// first layout the index is held until <see cref="OnSizeAllocated"/>;
    /// a reduced-motion user then gets an instant scroll instead of an
    /// animated one.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (!query.TryGetValue("channel", out var channel) || channel is not string key)
        {
            return;
        }

        _pendingCardIndex = BulletinJoinCards.PositionForKey(key);
        _ = RevealPendingCardAsync();
    }

    protected override void OnSizeAllocated(double width, double height)
    {
        base.OnSizeAllocated(width, height);
        _ = RevealPendingCardAsync();
    }

    private async Task RevealPendingCardAsync()
    {
        if (_pendingCardIndex is not { } index
            || index >= JoinCards.Children.Count
            || CardsScroll.Height <= 0)
        {
            return;
        }

        _pendingCardIndex = null;
        if (JoinCards.Children[index] is VisualElement card)
        {
            await CardsScroll.ScrollToAsync(
                card, ScrollToPosition.Center, MotionPreferences.PlatformPrefersMotion());
        }
    }
}
