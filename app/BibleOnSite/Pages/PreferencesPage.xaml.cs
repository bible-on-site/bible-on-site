using BibleOnSite.ViewModels;
using BibleOnSite.Controls;

namespace BibleOnSite.Pages;

/// <summary>
/// Settings overview: six category rows, each opening its own detail page.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class PreferencesPage : PreferencesPageBase, IQueryAttributable
#pragma warning restore S2333
{
    private readonly PreferencesViewModel _viewModel;
    private readonly Func<ExtensionPacksViewModel> _packsFactory;

    public PreferencesPage() : this(new PreferencesViewModel())
    {
    }

    public PreferencesPage(PreferencesViewModel viewModel)
        : this(viewModel, static () => new ExtensionPacksViewModel())
    {
    }

    internal PreferencesPage(PreferencesViewModel viewModel, Func<ExtensionPacksViewModel> packsFactory)
    {
        InitializeComponent();
        _viewModel = viewModel;
        _packsFactory = packsFactory;
        BindingContext = _viewModel;
    }

    private ExtensionPacksViewModel? _packs;
    private View? _packsView;
    private View? _overview;
    private bool _packsMode;

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        // The same instance is re-navigated to: section=packs swaps in the pack
        // view, and a later Preferences entry (whose query carries no section)
        // must restore the settings overview — a packs query must not trap the
        // page (#2926).
        if (query.TryGetValue("section", out var section) && section is "packs")
        {
            ShowPacks();
        }
        else
        {
            ShowOverview();
        }
    }

    private void ShowPacks()
    {
        // Capture the XAML-built overview once so a later non-packs navigation
        // can put it back on the same instance.
        _overview ??= Content;
        var reentering = _packs is not null && !_packsMode;
        _packs ??= _packsFactory();
        _packsView ??= new ExtensionPacksView();
        _packsMode = true;
        BindingContext = _packs;
        Content = _packsView;
        Title = "העדפות - חבילות הרחבה";
        if (reentering)
        {
            _ = _packs.LoadAsync();
        }
    }

    private void ShowOverview()
    {
        if (!_packsMode)
        {
            return;
        }
        _packsMode = false;
        BindingContext = _viewModel;
        Content = _overview;
        Title = "העדפות";
        _ = _viewModel.LoadAsync();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (_packsMode)
        {
            await _packs!.LoadAsync();
        }
        else
        {
            await _viewModel.LoadAsync();
        }
    }
}
