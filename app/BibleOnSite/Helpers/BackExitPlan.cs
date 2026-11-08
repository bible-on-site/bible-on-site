namespace BibleOnSite.Helpers;

/// <summary>
/// What the shared Shell back hook should do with a Back press the base
/// navigation pipeline left unconsumed.
/// </summary>
public enum BackExitAction
{
	/// <summary>Back was consumed (fullscreen dismissed or Shell handled it).</summary>
	Consume,

	/// <summary>
	/// Defer to the native layer. An open flyout is closed by the drawer
	/// layout's own back callback, and a native gesture probe (the iOS
	/// interactive-pop consultation) owns its pop outcome — the press must
	/// keep propagating.
	/// </summary>
	DeferToNative,

	/// <summary>
	/// Nothing consumed Back at the app root — the press would leave the app,
	/// so the exit confirmation must run first.
	/// </summary>
	ConfirmExit,
}

/// <summary>
/// Pure ordering rules for <see cref="AppShell"/>'s back hook, kept separate so
/// the dismissal → navigation → exit-confirmation order stays unit-testable.
/// Fullscreen dismissal is evaluated by the caller before this point — a
/// transient surface always owns Back before page navigation or app exit.
/// </summary>
public static class BackExitPlan
{
	/// <param name="navigationInFlight">
	/// A Shell navigation (push/pop) is still settling. The press is consumed
	/// without re-entering the Shell pipeline: a second pass can pop the page
	/// beneath the one already transitioning out, leaving an empty surface.
	/// </param>
	/// <param name="shellBack">Runs the base Shell back pipeline; invoked lazily
	/// so an in-flight navigation never triggers a second navigation.</param>
	/// <param name="flyoutPresented">The flyout drawer is open.</param>
	/// <param name="hasInAppHistory">
	/// Pushed pages remain on the Shell back stack. Since MAUI 10.0.120 the iOS
	/// edge-swipe pop gesture runs this hook before popping and the base Shell
	/// pipeline deliberately answers false — the gesture itself performs the
	/// pop once allowed — so an unhandled press only means "would leave the
	/// app" when no pushed page remains.
	/// </param>
	/// <param name="rootBackMayExit">
	/// Whether an unhandled Back press at the navigation root can leave the
	/// app (Android's system Back). iOS/MacCatalyst have no root Back source —
	/// the only consult reaching the hook there is UIKit's interactive-pop
	/// recognizer, which can stay enabled a beat after the stack already
	/// settled to the root. Treating that stale probe as an exit intent covers
	/// the page under the exit-confirmation dialog and cancels a harmless
	/// gesture, so it defers instead (#2701).
	/// </param>
	public static BackExitAction Evaluate(bool navigationInFlight, Func<bool> shellBack, bool flyoutPresented,
		bool hasInAppHistory, bool rootBackMayExit)
	{
		if (navigationInFlight || shellBack())
		{
			return BackExitAction.Consume;
		}

		return hasInAppHistory || flyoutPresented || !rootBackMayExit
			? BackExitAction.DeferToNative
			: BackExitAction.ConfirmExit;
	}
}
