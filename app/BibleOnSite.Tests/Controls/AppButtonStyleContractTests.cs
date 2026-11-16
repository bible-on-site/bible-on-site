using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Source-level contract for the shared action hierarchy (#3454): app buttons
/// converge on <see cref="BibleOnSite.Controls.AppButtonStyles"/> — a XAML
/// button may not redeclare the palette or clear the shared font, icon
/// buttons may not undercut the shared touch floors, ghost chrome that
/// intentionally stays transparent must also shed the shared outline, code
/// may not repaint a styled button's palette at runtime, and selected picker
/// rows keep white text on blue.
/// </summary>
public class AppButtonStyleContractTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";

    private static IEnumerable<(string File, XElement Button)> AppButtons()
    {
        foreach (var file in Directory.EnumerateFiles(AppRoot, "*.xaml", SearchOption.AllDirectories))
        {
            var doc = XDocument.Load(file);
            foreach (var button in doc.Descendants(Maui + "Button"))
            {
                yield return (file, button);
            }
        }
    }

    private static string Describe(string file, XElement button) =>
        $"{Path.GetFileName(file)} " +
        (button.Attributes().FirstOrDefault(a => a.Name.LocalName is "Name" or "AutomationId" or "Text")?.Value
            ?? "button");

    [Fact]
    public void Xaml_buttons_do_not_redeclare_the_shared_palette()
    {
        var offenders = AppButtons()
            .Where(entry => entry.Button.Attribute("BackgroundColor") is not null
                || entry.Button.Attribute("TextColor") is not null)
            .Select(entry => Describe(entry.File, entry.Button))
            .ToList();

        offenders.Should().BeEmpty(
            "button surface and ink come from AppButtonStyles — local colors defeat theme and state handling");
    }

    [Fact]
    public void Icon_buttons_keep_the_shared_touch_target()
    {
        var offenders = AppButtons()
            .Where(entry => entry.Button.Attribute("Style")?.Value is { } style
                && (style.Contains("AppButtonStyles.Icon") || style.Contains("AppButtonStyles.CompactIcon")))
            .Where(entry => entry.Button.Attribute("WidthRequest") is not null
                || entry.Button.Attribute("HeightRequest") is not null)
            .Select(entry => Describe(entry.File, entry.Button))
            .ToList();

        offenders.Should().BeEmpty(
            "Icon/CompactIcon own the 52/44dp sizing — a local size request undercuts the floor");
    }

    [Fact]
    public void Buttons_never_shrink_below_the_compact_floor()
    {
        foreach (var (file, button) in AppButtons())
        {
            foreach (var name in new[] { "WidthRequest", "HeightRequest", "MinimumWidthRequest", "MinimumHeightRequest" })
            {
                if (button.Attribute(name) is { } attribute
                    && double.TryParse(attribute.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var size))
                {
                    size.Should().BeGreaterThanOrEqualTo(44,
                        $"{Describe(file, button)} sets {name} below the shared touch floor");
                }
            }
        }
    }

    [Fact]
    public void Buttons_do_not_clear_the_shared_font()
    {
        var offenders = AppButtons()
            .Where(entry => entry.Button.Attribute("FontFamily")?.Value.Length == 0)
            .Select(entry => Describe(entry.File, entry.Button))
            .ToList();

        offenders.Should().BeEmpty(
            "an empty FontFamily drops the shared OpenSansRegular face");
    }

    [Theory]
    [InlineData("App.xaml.cs")]
    [InlineData("Controls/SharedTopBar.cs")]
    [InlineData("Controls/DeferredMediaElement.cs")]
    public void Ghost_buttons_shed_the_shared_outline(string file)
    {
        // A transparent button is intentional ghost chrome — but the implicit
        // Secondary style still rings it with an outline unless the border is
        // explicitly removed.
        var code = File.ReadAllText(Path.Join(AppRoot, file));
        var initializers = Regex.Matches(code, @"new Button\s*\{(?<body>[^{}]*)\}")
            .Select(match => match.Groups["body"].Value)
            .Where(body => body.Contains("Colors.Transparent"))
            .ToList();

        initializers.Should().NotBeEmpty($"{file} should keep its ghost button(s)");
        foreach (var body in initializers)
        {
            body.Should().Contain("BorderWidth = 0",
                $"transparent button in {file} must not wear the shared Secondary outline");
        }
    }

    [Fact]
    public void ReaderBottomBar_does_not_repaint_the_shared_palette_at_runtime()
    {
        var code = File.ReadAllText(Path.Join(AppRoot, "Controls", "ReaderBottomBar.xaml.cs"));

        code.Should().NotContain("SetAppThemeColor(Button.",
            "the active state swaps the shared style instead of overriding the palette");
    }

    [Fact]
    public void ReaderBottomBar_active_articles_keeps_the_compact_icon_face()
    {
        var code = File.ReadAllText(Path.Join(AppRoot, "Controls", "ReaderBottomBar.xaml.cs"));

        code.Should().Contain("AppButtonStyles.CompactIconSelected",
            "the active articles icon must keep its FluentIcons glyph and 44dp target — " +
            "the text Selected variant carries OpenSansRegular and the 48dp floor");
    }

    [Theory]
    [InlineData("PerekPickerPopup.xaml")]
    [InlineData("ParashaUnitPickerPopup.xaml")]
    [InlineData("MasoraUnitPickerPopup.xaml")]
    public void Picker_rows_stay_white_text_on_blue_when_selected(string file)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Controls", file));
        var selectedStates = doc.Descendants(Maui + "VisualState")
            .Where(state => (string?)state.Attribute("Name") == "Selected")
            .ToList();

        selectedStates.Should().NotBeEmpty("every picker row needs a visible selected state");
        foreach (var state in selectedStates)
        {
            var setters = state.Descendants(Maui + "Setter").ToList();
            setters.Should().Contain(setter =>
                    (string?)setter.Attribute("Property") == "BackgroundColor"
                    && ((string?)setter.Attribute("Value") ?? "").Contains("Primary"),
                "a selected row fills with the Primary blue");
            setters.Should().Contain(setter =>
                    ((string?)setter.Attribute("Property") ?? "").EndsWith("TextColor")
                    && (string?)setter.Attribute("Value") == "White",
                "a selected row keeps white text for contrast");
        }
    }

    [Theory]
    [InlineData("AppDialogAction", "AppButtonStyles.Primary")]
    [InlineData("AppDialogCancelAction", "AppButtonStyles.Secondary")]
    [InlineData("AppDialogDestructiveAction", "AppButtonStyles.Destructive")]
    public void Dialog_actions_build_on_the_shared_styles(string key, string basedOn)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Controls", "AppDialogPopup.xaml"));
        var style = doc.Descendants(Maui + "Style")
            .Single(element => (string?)element.Attribute(XNamespace.Get("http://schemas.microsoft.com/winfx/2009/xaml") + "Key") == key);

        ((string?)style.Attribute("BasedOn")).Should().Contain(basedOn,
            $"dialog action '{key}' must inherit the shared {basedOn} role");
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
