namespace BibleOnSite.ViewModels;

/// <summary>
/// The flyout destinations that can be marked as the current page's home
/// (#2766). Matches the destination rows declared in AppShell.xaml.
/// </summary>
public enum FlyoutDestination
{
	/// <summary>No flyout row claims the current page (loading screen,
	/// article/author detail reached inside a reader, unknown page).</summary>
	None,
	AlHaperek,
	Tanahpedia,
	LearningCalendar,
	Masora,
	Parasha,
	Moadim,
	Authors,
	DailyBulletin,
	Terms,
	Preferences,
	Contact,
	Donations,
}
