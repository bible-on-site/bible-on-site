using System.Runtime.CompilerServices;

namespace BibleOnSite.Helpers;

/// <summary>
/// Keeps one stable retry delegate per element so the same delegate can be
/// unsubscribed later. WinUI's <c>FrameworkElement.LayoutUpdated</c> always
/// invokes handlers with a null sender, so the delegate closes over the
/// element it retries instead of reading the event's sender (#3496).
/// </summary>
internal sealed class LayoutRetryMap<TElement> where TElement : class
{
	private readonly ConditionalWeakTable<TElement, EventHandler<object>> _handlers = new();

	public EventHandler<object> HandlerFor(TElement element, Action<TElement> retry) =>
		_handlers.GetValue(element, key => (_, _) => retry(key));

	/// <summary>Returns the element's retry delegate and forgets it, so the
	/// caller can unsubscribe exactly the handler that was attached.</summary>
	public EventHandler<object>? Remove(TElement element) =>
		_handlers.TryGetValue(element, out var handler) && _handlers.Remove(element)
			? handler
			: null;
}
