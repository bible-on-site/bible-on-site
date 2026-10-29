using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// עלון יומי (#2806): the daily-bulletin join carousel mirroring the website's
/// public join surface — Telegram, WhatsApp and email cards. Supports the
/// ?channel= deep link used by the flyout קבוצת ווטסאפ entry.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration and controls.
public partial class DailyBulletinPage : ContentPage, IQueryAttributable
#pragma warning restore S2333
{
    private readonly DailyBulletinViewModel _viewModel;

    public DailyBulletinPage()
    {
        InitializeComponent();
        _viewModel = new DailyBulletinViewModel();
        BindingContext = _viewModel;
    }

    /// <summary>
    /// ?channel=whatsapp (and friends) selects the matching card. Before the
    /// carousel exists the bound Position lands the card without motion; on an
    /// already-presented page a reduced-motion user gets an instant ScrollTo
    /// instead of an animated one.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (!query.TryGetValue("channel", out var channel) || channel is not string key)
        {
            return;
        }

        var index = BulletinJoinCards.PositionForKey(key);
        if (BulletinCarousel.Handler is null || MotionPreferences.PlatformPrefersMotion())
        {
            _viewModel.Position = index;
        }
        else
        {
            BulletinCarousel.ScrollTo(index, animate: false);
        }
    }
}
