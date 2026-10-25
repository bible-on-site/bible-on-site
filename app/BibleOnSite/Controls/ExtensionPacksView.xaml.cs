using BibleOnSite.ViewModels;

namespace BibleOnSite.Controls;

public partial class ExtensionPacksView : ContentView
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
