namespace BibleOnSite.Models;

/// <summary>An app destination surfaced by the home search, separate from content hits.</summary>
public sealed record NavigationSearchItem(string Title, string Subtitle, string Route, string SearchTerms);
