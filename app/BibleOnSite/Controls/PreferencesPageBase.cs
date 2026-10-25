namespace BibleOnSite.Controls;

/// <summary>The shared preferences template binds its Back affordance to this page state.</summary>
public class PreferencesPageBase : ContentPage
{
    public static readonly BindableProperty ShowBackProperty =
        BindableProperty.Create(nameof(ShowBack), typeof(bool), typeof(PreferencesPageBase), false);

    public bool ShowBack
    {
        get => (bool)GetValue(ShowBackProperty);
        set => SetValue(ShowBackProperty, value);
    }
}
