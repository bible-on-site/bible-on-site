using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The single-Back exit confirmation restored from the legacy Flutter app:
/// consume the press, ask once, exit only on confirmation, and swallow
/// repeated presses while the dialog is on screen.
/// </summary>
public class ExitConfirmationTests
{
	[Fact]
	public async Task Request_WhenConfirmed_ExitsTheApp()
	{
		var exited = false;
		var confirmation = new ExitConfirmation(() => Task.FromResult(true), () => exited = true);

		confirmation.Request().Should().BeTrue("the triggering press is always consumed");
		await confirmation.ActivePrompt!;

		exited.Should().BeTrue();
	}

	[Fact]
	public async Task Request_WhenCancelled_KeepsTheAppRunning()
	{
		var exited = false;
		var confirmation = new ExitConfirmation(() => Task.FromResult(false), () => exited = true);

		confirmation.Request();
		await confirmation.ActivePrompt!;

		exited.Should().BeFalse();
		confirmation.IsPromptShowing.Should().BeFalse();
	}

	[Fact]
	public async Task Request_WhilePromptShowing_DoesNotStackDialogs()
	{
		var promptCalls = 0;
		var promptGate = new TaskCompletionSource<bool>();
		var confirmation = new ExitConfirmation(() =>
		{
			promptCalls++;
			return promptGate.Task;
		}, () => { });

		confirmation.Request().Should().BeTrue();
		confirmation.Request().Should().BeTrue("repeated presses are still consumed");

		promptCalls.Should().Be(1, "a second press must not open another dialog");
		confirmation.IsPromptShowing.Should().BeTrue();

		promptGate.SetResult(false);
		await confirmation.ActivePrompt!;
	}

	[Fact]
	public async Task Request_AfterCancellation_CanPromptAgain()
	{
		var prompts = 0;
		var confirmation = new ExitConfirmation(() =>
		{
			prompts++;
			return Task.FromResult(false);
		}, () => { });

		confirmation.Request();
		await confirmation.ActivePrompt!;
		confirmation.Request();
		await confirmation.ActivePrompt!;

		prompts.Should().Be(2, "cancelling re-arms the confirmation for the next press");
	}

	[Fact]
	public async Task Request_WhenPromptFails_RecoversForNextPress()
	{
		var prompts = 0;
		var confirmation = new ExitConfirmation(() =>
		{
			prompts++;
			return prompts == 1
				? Task.FromException<bool>(new InvalidOperationException("dialog failed"))
				: Task.FromResult(false);
		}, () => { });

		confirmation.Request();
		var first = confirmation.ActivePrompt!;
		await first;
		first.IsCompletedSuccessfully.Should().BeTrue("prompt failures are logged, not thrown");

		confirmation.IsPromptShowing.Should().BeFalse();
		confirmation.Request();
		await confirmation.ActivePrompt!;
		prompts.Should().Be(2);
	}
}
