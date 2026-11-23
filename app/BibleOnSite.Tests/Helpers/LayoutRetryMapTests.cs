using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// #3496: WinUI's <c>FrameworkElement.LayoutUpdated</c> always invokes its
/// handlers with a null sender, so a retry handler that reads the sender is
/// dead code — the layout retry never ran and a late-realized row kept
/// <c>AccessibilityView.Raw</c> with no readable name. The retry must run on
/// the element the map captured for it.
/// </summary>
public class LayoutRetryMapTests
{
	private sealed class Row;

	[Fact]
	public void HandlerFor_NullSender_RetriesCapturedElement()
	{
		var retries = new LayoutRetryMap<Row>();
		var row = new Row();
		var retried = new List<Row>();
		var handler = retries.HandlerFor(row, retried.Add);

		// WinUI's LayoutUpdated contract: sender is always null.
		handler(null!, new object());

		retried.Should().Equal([row],
			"the retry fires for the captured element even though LayoutUpdated supplies no sender");
	}

	[Fact]
	public void HandlerFor_ReturnsStableDelegate_ForUnsubscribe()
	{
		var retries = new LayoutRetryMap<Row>();
		var row = new Row();

		retries.HandlerFor(row, _ => { })
			.Should().BeSameAs(retries.HandlerFor(row, _ => { }),
				"`-=` must detach the exact delegate `+=` attached");
	}

	[Fact]
	public void Remove_ReturnsDelegate_AndForgetsIt()
	{
		var retries = new LayoutRetryMap<Row>();
		var row = new Row();
		var handler = retries.HandlerFor(row, _ => { });

		retries.Remove(row).Should().BeSameAs(handler);
		retries.Remove(row).Should().BeNull();
	}
}
