using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Rendered-surface guards for the shared blocking dialog (#2630): the popup
/// markup keeps the unified surface/typography/color contract, the action row
/// stays RTL-mirrored instead of hard-coding a direction, and no call site
/// drifts back to a raw platform alert. These source-level assertions back the
/// behavioral coverage in <c>AppDialogTests</c>.
/// </summary>
public class AppDialogContractTests
{
	private static readonly string AppRoot = FindAppRoot();
	private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
	private static readonly XNamespace Toolkit = "http://schemas.microsoft.com/dotnet/2022/maui/toolkit";
	private static XDocument Popup => XDocument.Load(Path.Join(AppRoot, "Controls", "AppDialogPopup.xaml"));

	// — Surface, typography and colors ————————————————————————————————————

	[Fact]
	public void Card_UsesTheSharedSurfaceRadiusAndPadding()
	{
		var card = Popup.Descendants(Maui + "Border").Should().ContainSingle().Subject;
		((string?)card.Attribute("StrokeShape")).Should().Be("RoundRectangle 12");
		((string?)card.Attribute("Padding")).Should().Be("24");
		((string?)card.Attribute("BackgroundColor")).Should().ContainAll(
			["Surface", "SurfaceDark"], "the card follows the theme surface tokens in both themes");
	}

	[Fact]
	public void TitleAndMessage_KeepTheUniformHierarchy()
	{
		var title = Popup.Descendants(Maui + "Label").First(l => (string?)l.Attribute("FontAttributes") == "Bold");
		((string?)title.Attribute("FontSize")).Should().Be("20");
		var message = Popup.Descendants(Maui + "ScrollView").Single().Element(Maui + "Label")!;
		((string?)message.Attribute("FontSize")).Should().Be("16");
		Popup.Descendants(Maui + "ScrollView").Should().ContainSingle(
			"a long message scrolls inside its own region so the actions stay visible");
	}

	[Fact]
	public void ActionStyles_ColorByRole_NotByCaller()
	{
		XNamespace xaml = "http://schemas.microsoft.com/winfx/2009/xaml";
		var styles = Popup.Root!.Element(Toolkit + "Popup.Resources")!.Elements(Maui + "Style")
			.ToDictionary(s => (string)s.Attribute(xaml + "Key")!);
		styles.Keys.Should().Contain(["AppDialogAction", "AppDialogDestructiveAction"]);

		var safeText = StyleSetterValue(styles["AppDialogAction"], "TextColor");
		safeText.Should().ContainAll(["Primary", "PrimaryLight"],
			"safe actions render in theme blue in both themes (#2460)");
		var destructiveText = StyleSetterValue(styles["AppDialogDestructiveAction"], "TextColor");
		destructiveText.Should().ContainAll(["Error", "ErrorDark"],
			"destructive actions render in red in both themes");
		StyleSetterValue(styles["AppDialogAction"], "BackgroundColor").Should().Be("Transparent",
			"actions keep text-only coloring — never colored button backgrounds (#2460)");
	}

	private static string StyleSetterValue(XElement style, string property) =>
		(string?)style.Elements(Maui + "Setter")
			.Single(s => (string?)s.Attribute("Property") == property)
			.Attribute("Value") ?? string.Empty;

	// — RTL-mirrored ordering —————————————————————————————————————————————

	[Fact]
	public void Content_IsRightToLeft_AndTheActionRowInheritsIt()
	{
		Popup.Descendants().Attributes("FlowDirection")
			.Where(v => (string?)v == "LeftToRight").Should().BeEmpty(
				"a hard-coded LTR row would freeze the mirrored action order (#2630)");
		var content = Popup.Descendants(Maui + "VerticalStackLayout").Single();
		((string?)content.Attribute("FlowDirection")).Should().Be("RightToLeft");
		var actions = Popup.Descendants(Maui + "Grid").Single();
		actions.Attribute("FlowDirection").Should().BeNull(
			"the action row inherits the dialog's RTL flow so logical order [dismissal, affirmative] renders mirrored");
	}

	// — Call-site drift guard —————————————————————————————————————————————

	[Fact]
	public void NoCallSiteBypassesTheSharedDialogPath()
	{
		// Native alert/sheet/prompt entry points may appear ONLY in the
		// documented bootstrap fallback inside Services/AppDialog.cs.
		var nativeCall = new Regex(
			@"\.DisplayAlert\s*\(|\.DisplayActionSheet\s*\(|\.DisplayPromptAsync\s*\(|(?<![\w.])DisplayAlertAsync\s*\(",
			RegexOptions.Compiled);
		var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
		{
			Path.Join(AppRoot, "Services", "AppDialog.cs"),
			Path.Join(AppRoot, "Services", "IAppNavigator.cs"), // interface/forwarder names, not calls
		};
		var offenders = Directory.EnumerateFiles(AppRoot, "*.cs", SearchOption.AllDirectories)
			.Where(file => !file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
				&& !file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
			.Where(file => !allowed.Contains(file))
			.Where(file => nativeCall.IsMatch(File.ReadAllText(file)))
			.Select(file => Path.GetRelativePath(AppRoot, file))
			.ToList();
		offenders.Should().BeEmpty(
			"every blocking dialog routes through AppDialogs/ShellAppNavigator — " +
			"a raw platform call reintroduces the inconsistent styling #2630 removed");
	}

	[Fact]
	public void TheBespokeExitPopupWasRetiredIntoTheSharedOne()
	{
		File.Exists(Path.Join(AppRoot, "Controls", "ExitConfirmationPopup.xaml")).Should().BeFalse(
			"the one-off exit popup is replaced by the shared AppDialogPopup");
	}

	private static string FindAppRoot()
	{
		var dir = AppContext.BaseDirectory;
		while (dir != null)
		{
			var candidate = Path.Join(dir, "BibleOnSite");
			if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
			{
				return candidate;
			}

			var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
			if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
			{
				return siblingCandidate;
			}

			dir = Path.GetDirectoryName(dir);
		}

		throw new InvalidOperationException(
			"Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
	}
}
