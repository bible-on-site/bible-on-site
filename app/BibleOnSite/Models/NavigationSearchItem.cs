namespace BibleOnSite.Models;

/// <summary>A local app destination represented by the Screen kind in the shared search.</summary>
public sealed record NavigationSearchItem(string Title, string Subtitle, string Route, string SearchTerms);
