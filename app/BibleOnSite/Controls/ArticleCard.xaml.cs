using BibleOnSite.Models;

namespace BibleOnSite.Controls;

/// <summary>
/// A reusable card control for displaying article information.
/// Used in both ArticlesPage (rabbi articles) and PerekPage (perek articles).
/// Shows: Short abstract (h1 from content), author pic + name, "קרא עוד" indicator.
/// </summary>
public partial class ArticleCard : ContentView
{
    public static readonly BindableProperty ArticleProperty = BindableProperty.Create(
        nameof(Article),
        typeof(Article),
        typeof(ArticleCard),
        null);

    public static readonly BindableProperty ShowPerekSourceProperty = BindableProperty.Create(
        nameof(ShowPerekSource),
        typeof(bool),
        typeof(ArticleCard),
        false);

    /// <summary>
    /// The article to display.
    /// </summary>
    public Article? Article
    {
        get => (Article?)GetValue(ArticleProperty);
        set => SetValue(ArticleProperty, value);
    }

    /// <summary>
    /// Whether to show the perek source line (used when viewing articles by author).
    /// </summary>
    public bool ShowPerekSource
    {
        get => (bool)GetValue(ShowPerekSourceProperty);
        set => SetValue(ShowPerekSourceProperty, value);
    }

    public ArticleCard()
    {
        InitializeComponent();
    }
}
