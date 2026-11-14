using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Controls;

/// <summary>
/// The reader's two-column articles strip shared by the perek, parasha and
/// masora readers: article cards with a selected-stroke highlight, an
/// empty-state label, and a footer spacer sized to clear the bottom bar.
/// Selection clears itself and raises <see cref="ArticleSelected"/> — the page
/// owns navigation and view-model bookkeeping.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderArticlesView : CollectionView, IReaderArticlesSurface
#pragma warning restore S2333
{
    /// <summary>Raised when an article card is tapped (selection self-clears).</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler<Article>? ArticleSelected;
#pragma warning restore S3264

    public static readonly BindableProperty SelectedArticleIdProperty =
        BindableProperty.Create(nameof(SelectedArticleId), typeof(int?), typeof(ReaderArticlesView), null);

    /// <summary>
    /// The article id whose card shows the selected stroke — the page binds its
    /// view model's SelectedArticleId here.
    /// </summary>
    public int? SelectedArticleId
    {
        get => (int?)GetValue(SelectedArticleIdProperty);
        set => SetValue(SelectedArticleIdProperty, value);
    }

    public static readonly BindableProperty EmptyTextProperty =
        BindableProperty.Create(nameof(EmptyText), typeof(string), typeof(ReaderArticlesView), string.Empty);

    /// <summary>Empty-state text ("אין מאמרים לפרק זה" and friends).</summary>
    public string EmptyText
    {
        get => (string)GetValue(EmptyTextProperty);
        set => SetValue(EmptyTextProperty, value);
    }

    public ReaderArticlesView()
    {
        InitializeComponent();
        SelectionChanged += OnSelectionChanged;
    }

    private void OnSelectionChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is Article article)
        {
            SelectedItem = null;
            ArticleSelected?.Invoke(this, article);
        }
    }
}
