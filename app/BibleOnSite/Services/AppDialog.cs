namespace BibleOnSite.Services;

/// <summary>
/// Semantic role of a blocking-dialog action (#2630). An action's meaning comes
/// from its role — never from the Hebrew label text or from the position it was
/// passed in — so every caller gets the same color, ordering and result mapping.
/// </summary>
public enum AppDialogActionRole
{
	/// <summary>Dismissal that keeps the current state (ביטול, המשך ללמוד). Theme-blue text.</summary>
	Cancel,

	/// <summary>The single action of an information/error alert (אישור). Theme-blue text.</summary>
	Acknowledge,

	/// <summary>Affirmative, non-destructive action (עבור ל…). Theme-blue text.</summary>
	Confirm,

	/// <summary>Affirmative, destructive action (הסרה, צא מהישומון). Red text.</summary>
	Destructive,
}

/// <summary>One action button in a blocking dialog.</summary>
public sealed record AppDialogAction(string Text, AppDialogActionRole Role)
{
	/// <summary>Optional explicit AutomationId (e.g. the exit prompt keeps its
	/// e2e-referenced ExitConfirmationStay/ExitConfirmationExit ids). When null,
	/// the request derives one from its prefix and the action's role.</summary>
	public string? AutomationId { get; init; }
}

/// <summary>
/// Everything the shared presenter needs to render a blocking dialog. Actions
/// may be listed in any order; <see cref="OrderedActions"/> always yields the
/// contract's logical order.
/// </summary>
public sealed record AppDialogRequest
{
	public required string Title { get; init; }

	public required string Message { get; init; }

	public required IReadOnlyList<AppDialogAction> Actions { get; init; }

	/// <summary>
	/// AutomationId prefix for the card, title and message ("{prefix}Card",
	/// "{prefix}Title", "{prefix}Message") and the fallback for action ids.
	/// "ExitConfirmation" preserves the exit prompt's existing ids.
	/// </summary>
	public string AutomationIdPrefix { get; init; } = "AppDialog";

	/// <summary>Logical display order: dismissal at reading start, affirmative at reading end.</summary>
	public IReadOnlyList<AppDialogAction> OrderedActions => AppDialogPolicy.OrderActions(Actions);

	public string AutomationIdFor(AppDialogAction action) =>
		action.AutomationId ?? $"{AutomationIdPrefix}{action.Role}";

	/// <summary>Single-button information/error alert.</summary>
	public static AppDialogRequest Alert(string title, string message, string acknowledge) => new()
	{
		Title = title,
		Message = message,
		Actions = [new AppDialogAction(acknowledge, AppDialogActionRole.Acknowledge)],
	};

	/// <summary>Two-choice confirmation with a theme-blue affirmative.</summary>
	public static AppDialogRequest Confirmation(string title, string message,
		string confirm, string cancel) =>
		Confirmation(title, message, confirm, cancel, confirmIsDestructive: false);

	/// <summary>
	/// Two-choice confirmation. <paramref name="confirmIsDestructive"/> marks the
	/// affirmative action destructive (red) — removal, exit — versus a plain
	/// theme-blue confirm.
	/// </summary>
	public static AppDialogRequest Confirmation(string title, string message,
		string confirm, string cancel, bool confirmIsDestructive) => new()
	{
		Title = title,
		Message = message,
		Actions =
		[
			new AppDialogAction(cancel, AppDialogActionRole.Cancel),
			new AppDialogAction(confirm, confirmIsDestructive
				? AppDialogActionRole.Destructive
				: AppDialogActionRole.Confirm),
		],
	};
}

/// <summary>
/// Centralized layout tokens for the blocking-dialog family (#2630). The popup
/// view reads them through XAML/code-behind; keeping them here keeps the
/// contract testable instead of scattered across markup.
/// </summary>
public static class AppDialogStyle
{
	public static readonly double CornerRadius = 12;
	public static readonly double ContentPadding = 24;
	public static readonly double ContentSpacing = 16;
	public static readonly double ActionSpacing = 8;
	public static readonly double TitleFontSize = 20;
	public static readonly double MessageFontSize = 16;
	public static readonly double ActionFontSize = 16;

	/// <summary>Screen margin kept on each side of the card.</summary>
	public static readonly double HorizontalMargin = 24;

	/// <summary>Adaptive card-width cap (tablets/landscape get the cap, not a fixed width).</summary>
	public static readonly double MaxContentWidth = 400;

	/// <summary>The message area may scroll but never eats the action row.</summary>
	public static readonly double MaxMessageHeightFraction = 0.45;

	/// <summary>The dim behind every blocking dialog, regardless of theme.</summary>
	public static readonly Microsoft.Maui.Graphics.Color ScrimColor =
		Microsoft.Maui.Graphics.Color.FromArgb("#80000000");

	/// <summary>Bounded card width for a given host-page width.</summary>
	public static double WidthFor(double hostWidth) =>
		Math.Clamp(hostWidth - (2 * HorizontalMargin), 0, MaxContentWidth);

	/// <summary>Bounded message height for a given host-page height.</summary>
	public static double MaxMessageHeightFor(double hostHeight) =>
		Math.Max(0, hostHeight * MaxMessageHeightFraction);
}

/// <summary>The role/layout/style decisions every blocking dialog shares (#2630).</summary>
public static class AppDialogPolicy
{
	/// <summary>
	/// Logical action order: cancel/dismiss first (reading start), affirmative
	/// last (reading end). The action row keeps the dialog's RTL flow direction,
	/// so in this app's Hebrew context the dismissal renders at the right edge —
	/// where reading starts — and the affirmative at the left edge, where reading
	/// ends. That is the same mirrored placement Android and iOS use for Hebrew
	/// native alerts (positive at the end of the reading direction), and the
	/// ordering stays correct if the row is ever measured left-to-right, because
	/// the positions mirror with the layout instead of being hard-coded.
	/// Stacked/wrapped layouts keep the same sequence top-to-bottom.
	/// </summary>
	public static IReadOnlyList<AppDialogAction> OrderActions(IReadOnlyList<AppDialogAction> actions) =>
		actions.OrderBy(action => action.Role == AppDialogActionRole.Cancel ? 0 : 1).ToList();

	/// <summary>Roles that resolve a confirmation as "accepted".</summary>
	public static bool IsAffirmative(AppDialogActionRole role) =>
		role is AppDialogActionRole.Confirm or AppDialogActionRole.Destructive;

	/// <summary>
	/// Action text colors by role, as keys in the popup's resource dictionary:
	/// theme blue for safe/non-destructive actions, red for destructive ones —
	/// foreground text color, never colored button backgrounds (#2460).
	/// </summary>
	public static string StyleKeyFor(AppDialogActionRole role) =>
		role == AppDialogActionRole.Destructive
			? "AppDialogDestructiveAction"
			: "AppDialogAction";
}

/// <summary>
/// The single entry point every app-controlled blocking dialog goes through
/// (#2630): information/error alerts, two-choice confirmations and destructive
/// confirmations. The styled presenter (<see cref="UsePresenter"/>) owns the
/// visual contract; when it is not installed — before the Shell finishes
/// booting, or when no window can host a popup — the dialog degrades to the
/// platform alert so an early error is never swallowed. Pickers and content
/// sheets keep their own popups; they share the design language without being
/// forced into this interaction model. OS-owned permission/system dialogs stay
/// native.
/// </summary>
public static class AppDialogs
{
	private static Func<AppDialogRequest, Task<AppDialogAction?>>? _presenter;

	/// <summary>
	/// Installs the app-owned presenter — called by the shell at startup with the
	/// shared popup (<c>AppDialogPopup.ShowAsync</c>). Tests substitute a
	/// recording stub; passing null restores the native fallback.
	/// </summary>
	public static void UsePresenter(Func<AppDialogRequest, Task<AppDialogAction?>>? presenter) =>
		_presenter = presenter;

	/// <summary>Shows an information/error alert with one acknowledge action.</summary>
	public static Task AlertAsync(string title, string message, string acknowledge) =>
		ShowAsync(AppDialogRequest.Alert(title, message, acknowledge));

	/// <summary>Non-destructive two-choice confirmation (confirm in theme blue).</summary>
	public static Task<bool> ConfirmAsync(string title, string message, string confirm, string cancel) =>
		ConfirmAsync(AppDialogRequest.Confirmation(title, message, confirm, cancel));

	/// <summary>Destructive two-choice confirmation (affirmative in red).</summary>
	public static Task<bool> ConfirmDestructiveAsync(string title, string message, string destructive, string cancel) =>
		ConfirmAsync(AppDialogRequest.Confirmation(title, message, destructive, cancel, confirmIsDestructive: true));

	/// <summary>
	/// Resolves to the tapped action, or null when the dialog was dismissed
	/// safely — outside tap, system Back or an absent presenter. Callers map the
	/// action, so dismissing always means "keep the current state" and can never
	/// be read as an accept.
	/// </summary>
	public static async Task<AppDialogAction?> ShowAsync(AppDialogRequest request) =>
		_presenter is { } presenter
			? await presenter(request)
			: await NativeFallbackAsync(request);

	/// <summary>True only when the resolved action is the affirmative one.</summary>
	public static async Task<bool> ConfirmAsync(AppDialogRequest request)
	{
		var action = await ShowAsync(request);
		return action is not null && AppDialogPolicy.IsAffirmative(action.Role);
	}

	/// <summary>
	/// Bootstrap path for when no styled presenter can run: maps the contract
	/// onto the two-slot platform alert (affirmative = accept, dismissal = cancel).
	/// This is a fallback, not a second presenter — callers never see it once the
	/// shell installs the styled one.
	/// </summary>
	private static async Task<AppDialogAction?> NativeFallbackAsync(AppDialogRequest request)
	{
		var page = Application.Current?.Windows.FirstOrDefault()?.Page;
		if (page is null)
		{
			return null;
		}

		var ordered = request.OrderedActions;
		if (ordered.Count == 1)
		{
			await page.DisplayAlertAsync(request.Title, request.Message, ordered[0].Text);
			return ordered[0];
		}

		var cancel = ordered.FirstOrDefault(a => a.Role == AppDialogActionRole.Cancel);
		var affirmative = ordered.LastOrDefault(a => AppDialogPolicy.IsAffirmative(a.Role));
		if (ordered.Count == 2 && cancel is not null && affirmative is not null)
		{
			var accepted = await page.DisplayAlertAsync(request.Title, request.Message, affirmative.Text, cancel.Text);
			return accepted ? affirmative : cancel;
		}

		// A request that is neither a single acknowledge nor a cancel+affirmative
		// pair cannot be represented by the two-slot native alert. Safe-null —
		// the caller reads it as dismissal, never as an accept.
		return null;
	}
}
