using BibleOnSite.ViewModels;

namespace BibleOnSite.Controls;

#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ExtensionPacksView : ContentView
#pragma warning restore S2333
{
    public ExtensionPacksView() => InitializeComponent();

    /// <summary>Per-book download/complete: the button's CommandParameter carries the row's book choice.</summary>
    private async void OnDownloadBookClicked(object? sender, EventArgs e)
    {
        if (sender is Button { CommandParameter: RecitationBookChoice book })
        {
            await ((ExtensionPacksViewModel)BindingContext).Packs.DownloadBookAsync(book);
        }
    }

    /// <summary>Per-book removal: the button's CommandParameter carries the row's book choice.</summary>
    private async void OnRemoveBookClicked(object? sender, EventArgs e)
    {
        if (sender is Button { CommandParameter: RecitationBookChoice book })
        {
            await ((ExtensionPacksViewModel)BindingContext).Packs.RemoveBookAsync(book);
        }
    }
}
