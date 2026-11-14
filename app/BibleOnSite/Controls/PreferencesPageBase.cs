using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>The shared preferences template binds its Back affordance to this page state.</summary>
public class PreferencesPageBase : ContentPage
{
    public PreferencesPageBase()
    {
        // Resolve the persisted policy up front (#2927): the template binds
        // this into the capsule before the first frame lays out, so the
        // navigation-time BackChrome apply must land on the same value — a
        // late correction is what reflowed headers in 5.0.210.
        ShowBack = BackChromePolicy.ShowCapsuleBack(BackChrome.CurrentPlatform,
            PreferencesService.Instance.InAppBackButton);
    }

    public static readonly BindableProperty ShowBackProperty =
        BindableProperty.Create(nameof(ShowBack), typeof(bool), typeof(PreferencesPageBase), false);

    public bool ShowBack
    {
        get => (bool)GetValue(ShowBackProperty);
        set => SetValue(ShowBackProperty, value);
    }
}
