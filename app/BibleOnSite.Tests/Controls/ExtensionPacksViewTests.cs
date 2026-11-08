using System.Reflection;
using BibleOnSite.Controls;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Moq;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// The חבילות הרחבה code-behind routes per-book button taps to the view-model.
/// XAML visuals are device-tested; these tests drive the click handlers
/// directly with the same sender shapes the buttons produce.
/// </summary>
public class ExtensionPacksViewTests : IAsyncDisposable
{
    private readonly TestStorage _storage = new();
    private readonly ExtensionPacksViewModel _viewModel;

    public ExtensionPacksViewTests()
    {
        var pad = NotesDeliveryTests.Pad().Object;
        var notes = PerushimNotesService.CreateForTesting(pad, _storage.Root);
        var recitation = new RecitationService(_storage.FileSystem.Object, pad);
        var perekData = new PerekDataService(new LocalDatabaseService(_storage.FileSystem.Object));
        _viewModel = new ExtensionPacksViewModel(notes, recitation, perekData, new Mock<IAppNavigator>().Object);
    }

    public async ValueTask DisposeAsync() => await _storage.DisposeAsync();

    private static readonly MethodInfo DownloadHandler = typeof(ExtensionPacksView)
        .GetMethod("OnDownloadBookClicked", BindingFlags.NonPublic | BindingFlags.Instance)!;
    private static readonly MethodInfo RemoveHandler = typeof(ExtensionPacksView)
        .GetMethod("OnRemoveBookClicked", BindingFlags.NonPublic | BindingFlags.Instance)!;

    private ExtensionPacksView CreateView()
    {
        var view = new ExtensionPacksView { BindingContext = _viewModel };
        return view;
    }

    private static RecitationBookChoice Book(string name = "בראשית", bool canDownload = false) =>
        new() { Name = name, PerekIds = [], CanDownload = canDownload };

    [Fact]
    public void DownloadBook_Click_WithBookChoice_StartsTheBookDownload()
    {
        var view = CreateView();
        var book = Book();
        var button = new Button { CommandParameter = book };

        DownloadHandler.Invoke(view, [button, EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be("אין הקלטות זמינות להורדה בספר בראשית.");
    }

    [Fact]
    public void RemoveBook_Click_WithBookChoice_StartsTheBookRemoval()
    {
        var view = CreateView();
        var book = Book();
        var button = new Button { CommandParameter = book };

        RemoveHandler.Invoke(view, [button, EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be("אין הקלטות מותקנות להסרה בספר בראשית.");
    }

    [Fact]
    public void DownloadBook_Click_WithoutBookChoice_DoesNothing()
    {
        var view = CreateView();
        var initial = _viewModel.Packs.Status;

        // A button whose parameter is not a book choice, and a non-button sender.
        DownloadHandler.Invoke(view, [new Button { CommandParameter = "לא ספר" }, EventArgs.Empty]);
        DownloadHandler.Invoke(view, [new Label { Text = "x" }, EventArgs.Empty]);
        DownloadHandler.Invoke(view, [null, EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be(initial);
    }

    [Fact]
    public void RemoveBook_Click_WithoutBookChoice_DoesNothing()
    {
        var view = CreateView();
        var initial = _viewModel.Packs.Status;

        RemoveHandler.Invoke(view, [new Button(), EventArgs.Empty]);
        RemoveHandler.Invoke(view, [new Label(), EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be(initial);
    }
}
