using BibleOnSite.Helpers;
using BibleOnSite.Services;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Internals;
using Microsoft.Extensions.DependencyInjection;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// The shared blocking-dialog contract (#2630): role semantics, RTL-safe action
/// ordering, the presenter seam and the never-false-accept result mapping.
/// </summary>
[Collection("Application state")]
public class AppDialogTests
{
	private sealed class TestApplication(Page? page) : Application
	{
		protected override Window CreateWindow(IActivationState? activationState)
		{
			_ = activationState;
			return page == null ? new Window() : new Window(page);
		}
	}

	// — Role semantics and ordering ————————————————————————————————————————

	[Fact]
	public void OrderedActions_PlacesDismissalBeforeAffirmative()
	{
		var request = AppDialogRequest.Confirmation("title", "message", "אישור", "ביטול");

		request.OrderedActions.Select(a => a.Role).Should().Equal(
			[AppDialogActionRole.Cancel, AppDialogActionRole.Confirm],
			"the dismissal reads first (right edge in RTL) and the affirmative last (left edge)");
	}

	[Fact]
	public void OrderedActions_KeepsTheRuleWhenCallersListTheAffirmativeFirst()
	{
		var actions = new List<AppDialogAction>
		{
			new("הסרה", AppDialogActionRole.Destructive),
			new("ביטול", AppDialogActionRole.Cancel),
		};
		var request = new AppDialogRequest { Title = "t", Message = "m", Actions = actions };

		request.OrderedActions.Select(a => a.Role).Should().Equal(
			[AppDialogActionRole.Cancel, AppDialogActionRole.Destructive],
			"ordering comes from roles, never from the order arguments happened to be passed in");
	}

	[Theory]
	[InlineData(AppDialogActionRole.Cancel, false)]
	[InlineData(AppDialogActionRole.Acknowledge, false)]
	[InlineData(AppDialogActionRole.Confirm, true)]
	[InlineData(AppDialogActionRole.Destructive, true)]
	public void IsAffirmative_OnlyCountsConfirmingRoles(AppDialogActionRole role, bool expected) =>
		AppDialogPolicy.IsAffirmative(role).Should().Be(expected);

	[Theory]
	[InlineData(AppDialogActionRole.Cancel, "AppDialogAction")]
	[InlineData(AppDialogActionRole.Acknowledge, "AppDialogAction")]
	[InlineData(AppDialogActionRole.Confirm, "AppDialogAction")]
	[InlineData(AppDialogActionRole.Destructive, "AppDialogDestructiveAction")]
	public void StyleKeyFor_MapsDestructiveToRedAndEverythingElseToThemeBlue(
		AppDialogActionRole role, string expected) =>
		AppDialogPolicy.StyleKeyFor(role).Should().Be(expected);

	// — Request factories ——————————————————————————————————————————————————

	[Fact]
	public void Alert_HasASingleAcknowledgeAction()
	{
		var request = AppDialogRequest.Alert("שגיאה", "message", "אישור");

		request.Actions.Should().ContainSingle();
		request.Actions[0].Role.Should().Be(AppDialogActionRole.Acknowledge);
		request.Actions[0].Text.Should().Be("אישור");
	}

	[Fact]
	public void Confirmation_MarksTheAffirmativeDestructiveOnlyWhenAsked()
	{
		AppDialogRequest.Confirmation("t", "m", "הסרה", "ביטול")
			.Actions.Should().NotContain(a => a.Role == AppDialogActionRole.Destructive);
		var destructive = AppDialogRequest.Confirmation("t", "m", "הסרה", "ביטול", confirmIsDestructive: true);
		destructive.Actions.Should().ContainSingle(a => a.Role == AppDialogActionRole.Destructive);
	}

	[Fact]
	public void AutomationIds_DeriveFromPrefixAndRole_UnlessExplicit()
	{
		var request = AppDialogRequest.Confirmation("t", "m", "הסרה", "ביטול", confirmIsDestructive: true);
		request.AutomationIdFor(request.Actions[0]).Should().Be("AppDialogCancel");
		request.AutomationIdFor(request.Actions[1]).Should().Be("AppDialogDestructive");

		var exitLike = new AppDialogRequest
		{
			Title = "t",
			Message = "m",
			AutomationIdPrefix = "ExitConfirmation",
			Actions = [new AppDialogAction("x", AppDialogActionRole.Cancel) { AutomationId = "ExitConfirmationStay" }],
		};
		exitLike.AutomationIdFor(exitLike.Actions[0]).Should().Be("ExitConfirmationStay",
			"explicit ids keep e2e-referenced names stable");
	}

	// — Style tokens ———————————————————————————————————————————————————————

	[Theory]
	[InlineData(360, 312)]
	[InlineData(1000, 400)]
	[InlineData(40, 0)]
	public void WidthFor_ClampsToScreenMarginsAndTheMaxWidth(double hostWidth, double expected) =>
		AppDialogStyle.WidthFor(hostWidth).Should().Be(expected);

	[Fact]
	public void MaxMessageHeightFor_BoundsTheScrollableMessageArea() =>
		AppDialogStyle.MaxMessageHeightFor(800).Should().Be(360);

	[Fact]
	public void ScrimColor_IsAConsistentDimForEveryTheme()
	{
		AppDialogStyle.ScrimColor.Alpha.Should().BeApproximately(0.5f, 0.01f);
		AppDialogStyle.ScrimColor.Red.Should().Be(0);
		AppDialogStyle.ScrimColor.Green.Should().Be(0);
		AppDialogStyle.ScrimColor.Blue.Should().Be(0);
	}

	// — Presenter seam: the styled dialog ——————————————————————————————————

	[Fact]
	public async Task Alert_ForwardsTheAlertRequestToTheStyledPresenter()
	{
		AppDialogRequest? captured = null;
		AppDialogs.UsePresenter(request =>
		{
			captured = request;
			return Task.FromResult<AppDialogAction?>(request.Actions[0]);
		});
		try
		{
			await ShellAppNavigator.Instance.DisplayAlertAsync("שגיאה", "message", "אישור");
			captured.Should().NotBeNull();
			captured!.Title.Should().Be("שגיאה");
			captured.Message.Should().Be("message");
			captured.Actions.Should().ContainSingle(a => a.Role == AppDialogActionRole.Acknowledge);
		}
		finally
		{
			AppDialogs.UsePresenter(null);
		}
	}

	[Fact]
	public async Task DestructiveChoice_PresentsCancelFirstAndDestructiveLast()
	{
		AppDialogRequest? captured = null;
		AppDialogs.UsePresenter(request =>
		{
			captured = request;
			return Task.FromResult<AppDialogAction?>(request.OrderedActions[^1]);
		});
		try
		{
			var accepted = await ShellAppNavigator.Instance
				.DisplayDestructiveChoiceAsync("הסרת חבילת הפירושים", "message", "הסרה", "ביטול");

			accepted.Should().BeTrue("the affirmative action was tapped");
			captured.Should().NotBeNull();
			captured!.OrderedActions.Select(a => a.Role).Should().Equal(
				AppDialogActionRole.Cancel, AppDialogActionRole.Destructive);
			captured.OrderedActions[0].Text.Should().Be("ביטול");
			captured.OrderedActions[1].Text.Should().Be("הסרה");
		}
		finally
		{
			AppDialogs.UsePresenter(null);
		}
	}

	[Theory]
	[InlineData(true)]
	[InlineData(false)]
	public async Task Choice_ResultMapsOnlyTheAffirmativeTap(bool tapAffirmative)
	{
		AppDialogs.UsePresenter(request =>
			Task.FromResult<AppDialogAction?>(tapAffirmative ? request.OrderedActions[^1] : request.OrderedActions[0]));
		try
		{
			(await ShellAppNavigator.Instance.DisplayChoiceAsync("t", "m", "accept", "cancel"))
				.Should().Be(tapAffirmative);
		}
		finally
		{
			AppDialogs.UsePresenter(null);
		}
	}

	[Fact]
	public async Task Choice_WhenDismissed_ReturnsFalse_NeverAFalseAccept()
	{
		AppDialogs.UsePresenter(_ => Task.FromResult<AppDialogAction?>(null));
		try
		{
			(await ShellAppNavigator.Instance.DisplayDestructiveChoiceAsync("t", "m", "הסרה", "ביטול"))
				.Should().BeFalse("outside-tap/Back dismissal means keep the current state");
		}
		finally
		{
			AppDialogs.UsePresenter(null);
		}
	}

	// — Native fallback (no styled presenter installed) ————————————————————

	[Theory]
	[InlineData(false)]
	[InlineData(true)]
	public async Task Fallback_BeforeWindowOrPageCreation_CompletesSafely(bool createWindow)
	{
		var previous = Application.Current;
		try
		{
			var application = new TestApplication(null);
			Application.Current = application;
			if (createWindow)
			{
				((IApplication)application).CreateWindow(null!);
			}

			await ShellAppNavigator.Instance.DisplayAlertAsync("title", "message", "cancel");
			(await ShellAppNavigator.Instance.DisplayDestructiveChoiceAsync("t", "m", "a", "c"))
				.Should().BeFalse("a dialog that cannot appear must never report acceptance");
		}
		finally
		{
			Application.Current = previous;
		}
	}

	[Theory]
	[InlineData(true)]
	[InlineData(false)]
	public async Task Fallback_Choice_MapsTheNativeAcceptSlotOntoTheAffirmativeAction(bool accepted)
	{
		var previous = Application.Current;
		try
		{
			var page = new ContentPage();
			var application = new TestApplication(page);
			Application.Current = application;
			var window = ((IApplication)application).CreateWindow(null!);
			AlertArguments? request = null;
			using var services = new ServiceCollection()
				.AddKeyedSingleton<Func<Page, AlertArguments, Task<bool>>>("Microsoft.Maui.Controls.DisplayAlert", (_, _) =>
					(_, arguments) =>
					{
						request = arguments;
						return Task.FromResult(accepted);
					})
				.BuildServiceProvider();
			var context = new Mock<IMauiContext>();
			context.SetupGet(c => c.Services).Returns(services);
			var windowHandler = new Mock<IElementHandler>();
			windowHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
			window.Handler = windowHandler.Object;
			var pageHandler = new Mock<IViewHandler>();
			pageHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
			page.Handler = pageHandler.Object;

			var result = await ShellAppNavigator.Instance
				.DisplayDestructiveChoiceAsync("title", "message", "הסרה", "ביטול")
				.WaitAsync(TimeSpan.FromSeconds(2), TestContext.Current.CancellationToken);

			result.Should().Be(accepted);
			request.Should().NotBeNull();
			request!.Accept.Should().Be("הסרה", "the destructive action owns the native accept slot");
			request.Cancel.Should().Be("ביטול");
		}
		finally
		{
			Application.Current = previous;
		}
	}

	[Fact]
	public async Task Fallback_RequestWithoutACancelPair_ResolvesAsDismissal()
	{
		var previous = Application.Current;
		try
		{
			var page = new ContentPage();
			var application = new TestApplication(page);
			Application.Current = application;
			var window = ((IApplication)application).CreateWindow(null!);
			var nativeCalls = 0;
			using var services = new ServiceCollection()
				.AddKeyedSingleton<Func<Page, AlertArguments, Task<bool>>>("Microsoft.Maui.Controls.DisplayAlert", (_, _) =>
					(_, _) =>
					{
						nativeCalls++;
						return Task.FromResult(true);
					})
				.BuildServiceProvider();
			var context = new Mock<IMauiContext>();
			context.SetupGet(c => c.Services).Returns(services);
			var windowHandler = new Mock<IElementHandler>();
			windowHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
			window.Handler = windowHandler.Object;
			var pageHandler = new Mock<IViewHandler>();
			pageHandler.SetupGet(h => h.MauiContext).Returns(context.Object);
			page.Handler = pageHandler.Object;

			var request = new AppDialogRequest
			{
				Title = "t",
				Message = "m",
				Actions =
				[
					new AppDialogAction("a", AppDialogActionRole.Confirm),
					new AppDialogAction("b", AppDialogActionRole.Confirm),
				],
			};
			(await AppDialogs.ShowAsync(request)).Should().BeNull(
				"a request the two-slot native alert cannot represent degrades to dismissal, never to an accept");
			nativeCalls.Should().Be(0);
		}
		finally
		{
			Application.Current = previous;
		}
	}

	// — The exit prompt through the shared contract ————————————————————————

	[Theory]
	[InlineData(AppDialogActionRole.Destructive, true)]
	[InlineData(AppDialogActionRole.Cancel, false)]
	public async Task ExitPrompt_ResolvesExitOnlyOnTheDestructiveAction(AppDialogActionRole chosen, bool expectExit)
	{
		AppDialogRequest? captured = null;
		AppDialogs.UsePresenter(request =>
		{
			captured = request;
			return Task.FromResult<AppDialogAction?>(request.Actions.Single(a => a.Role == chosen));
		});
		try
		{
			(await ExitConfirmation.SharedPrompt()).Should().Be(expectExit,
				"the destructive exit action leaves; staying and dismissing keep studying");

			captured.Should().NotBeNull();
			captured!.Title.Should().Be(ExitConfirmation.Title);
			captured.Message.Should().Be(ExitConfirmation.Message);
			captured.AutomationIdPrefix.Should().Be("ExitConfirmation");
			captured.OrderedActions.Select(a => (a.Role, a.AutomationId, a.Text)).Should().Equal(
				(AppDialogActionRole.Cancel, "ExitConfirmationStay", ExitConfirmation.StayLabel),
				(AppDialogActionRole.Destructive, "ExitConfirmationExit", ExitConfirmation.ExitLabel));
		}
		finally
		{
			AppDialogs.UsePresenter(null);
		}
	}
}
