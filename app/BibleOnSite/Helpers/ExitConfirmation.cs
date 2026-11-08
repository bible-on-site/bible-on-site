using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// Single-Back exit protection, restored after the migration from the legacy
/// Flutter app. There a root WillPopScope awaited confirmExit(): staying kept
/// studying, confirming left the app. Here the shared Shell back hook asks for
/// the same confirmation only when a press would otherwise leave the app.
/// </summary>
public sealed class ExitConfirmation
{
	public static string Title => "תנ\"ך על הפרק";
	public static string Message => "מקווים שהלימוד היה מועיל, להתראות בפרק הבא!";
	public static string ExitLabel => "צא מהישומון";
	public static string StayLabel => "המשך ללמוד";

	private static readonly Lazy<ExitConfirmation> _shared = new(CreateDefault);

	/// <summary>App-wide instance wired to the Shell alert and platform exit.</summary>
	public static ExitConfirmation Shared => _shared.Value;

	private readonly Func<Task<bool>> _prompt;
	private readonly Action _exit;
	private bool _promptShowing;

	/// <summary>
	/// Injectable so tests can drive the prompt decision and observe the exit.
	/// </summary>
	public ExitConfirmation(Func<Task<bool>> prompt, Action exit)
	{
		_prompt = prompt;
		_exit = exit;
	}

	/// <summary>True while the confirmation dialog is on screen.</summary>
	public bool IsPromptShowing => _promptShowing;

	/// <summary>The running prompt task — tests await it instead of polling.</summary>
	internal Task? ActivePrompt { get; private set; }

	/// <summary>
	/// Records a Back press that would exit the app. Always returns true so the
	/// press is consumed: repeated presses while the dialog is up are swallowed
	/// rather than stacking dialogs or slipping past the confirmation.
	/// </summary>
	public bool Request()
	{
		if (_promptShowing)
		{
			return true;
		}

		_promptShowing = true;
		ActivePrompt = PromptAsync();
		return true;
	}

	private async Task PromptAsync()
	{
		try
		{
			if (await _prompt())
			{
				_exit();
			}
		}
		#pragma warning disable S2221 // Deliberate failure boundary: the prompt is an injected delegate + platform dialog — no narrower type enumerates its failures; a failed prompt keeps the app open (the press was already consumed) and finally re-arms for the next press
		catch (Exception ex) //NOSONAR — a failed exit prompt keeps the app open and re-arms; the press was already consumed.
		{
		    #pragma warning restore S2221
			Console.Error.WriteLine($"[Exit] confirmation prompt failed: {ex}");
		}
		finally
		{
			_promptShowing = false;
		}
	}

	private static Func<Task<bool>>? _platformPrompt;

	/// <summary>
	/// Overrides the prompt delegate — kept for tests that drive the exit
	/// decision directly. Production uses <see cref="SharedPrompt"/>, which runs
	/// through the shared dialog presenter (#2630).
	/// </summary>
	public static void UsePlatformPrompt(Func<Task<bool>>? prompt) => _platformPrompt = prompt;

	private static ExitConfirmation CreateDefault()
	{
		return new ExitConfirmation(
			prompt: () => _platformPrompt?.Invoke() ?? SharedPrompt(),
			exit: ExitApp);
	}

	/// <summary>
	/// The exit prompt as a shared dialog request (#2630): המשך ללמוד stays the
	/// safe dismissal in theme blue, צא מהישומון is the destructive affirmative
	/// in red (#2460). The AutomationIds stay stable for the Android e2e suite.
	/// </summary>
	internal static Task<bool> SharedPrompt() =>
		AppDialogs.ConfirmAsync(new AppDialogRequest
		{
			Title = Title,
			Message = Message,
			AutomationIdPrefix = "ExitConfirmation",
			Actions =
			[
				new AppDialogAction(StayLabel, AppDialogActionRole.Cancel) { AutomationId = "ExitConfirmationStay" },
				new AppDialogAction(ExitLabel, AppDialogActionRole.Destructive) { AutomationId = "ExitConfirmationExit" },
			],
		});

	[System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
		Justification = "Platform exit path — each branch is #if-gated to its OS, so the unit-test host compiles to a no-op.")]
	private static void ExitApp()
	{
#if ANDROID
		// The confirmed press mirrors a root Back the system did not get to run.
		Platform.CurrentActivity?.Finish();
#elif WINDOWS || MACCATALYST
		Application.Current?.Quit();
#endif
	}
}
