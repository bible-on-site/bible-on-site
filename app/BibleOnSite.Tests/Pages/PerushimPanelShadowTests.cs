using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>Guards the shared reader sheet against the painted-cover and empty-view regressions.</summary>
public class PerushimPanelShadowTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
    private static XDocument Sheet => XDocument.Load(Path.Join(AppRoot, "Controls", "PerushimSheet.xaml"));

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Reader_uses_the_shared_sheet(string pageFile)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));
        XNamespace controls = "clr-namespace:BibleOnSite.Controls";
        doc.Descendants(controls + "PerushimSheet").Should().ContainSingle();
    }

    [Fact]
    public void Sheet_does_not_use_the_native_shadow_wrapper()
    {
        Sheet.Root!.Element(Maui + "Border.Shadow").Should().BeNull();
        ((string?)Sheet.Root.Attribute("StrokeShape")).Should().Contain("RoundRectangle");
        ((string?)Sheet.Root.Attribute("StrokeThickness")).Should().Be("1");
    }

    [Fact]
    public void Content_extends_behind_the_transparent_bottom_bar_notch()
    {
        var viewport = Sheet.Root!.Element(Maui + "Grid")!;
        ((string?)viewport.Attribute("Margin")).Should().BeNull("a rectangular bottom inset hides content through the bar notch");
        ((string?)viewport.Attribute("IsClippedToBounds")).Should().Be("True");
    }

    [Fact]
    public void Empty_content_uses_a_separate_scroll_host_without_a_scroll_indicator()
    {
        var doc = Sheet;
        doc.Descendants(Maui + "CollectionView.EmptyView").Should().BeEmpty();
        ((string?)doc.Descendants(Maui + "CollectionView").Single().Attribute("VerticalScrollBarVisibility")).Should().Be("Never");
        var empty = doc.Descendants(Maui + "ScrollView").Single();
        ((string?)empty.Attribute("VerticalScrollBarVisibility")).Should().Be("Never");
        empty.Descendants(Maui + "Button").Should().HaveCount(2,
            "download and support actions stay inside the same bounded empty-content host");
    }

    [Fact]
    public void Scrollable_content_can_clear_the_bottom_bar_without_clipping_its_viewport()
    {
        var footer = Sheet.Descendants(Maui + "CollectionView.Footer").Single();
        ((string?)footer.Element(Maui + "BoxView")!.Attribute("HeightRequest")).Should().Be("90");
        var emptyContent = Sheet.Descendants(Maui + "ScrollView").Single().Element(Maui + "VerticalStackLayout")!;
        ((string?)emptyContent.Attribute("Padding")).Should().Be("0,8,0,102");
    }

    [Fact]
    public void Blocking_dialog_content_can_shrink_within_the_available_screen_width()
    {
        var popup = XDocument.Load(Path.Join(AppRoot, "Controls", "AppDialogPopup.xaml"));
        popup.Descendants(Maui + "VerticalStackLayout").Should().NotBeEmpty();
        popup.Descendants(Maui + "VerticalStackLayout").Attributes("WidthRequest").Should().BeEmpty(
            "a fixed content width plus popup padding and margins overflows a small screen");
        popup.Descendants(Maui + "Grid").Should().ContainSingle(
            "equal bounded action columns keep enlarged button text inside the dialog");
    }
    [Fact]
    public void Drag_handle_includes_the_sheet_top_padding()
    {
        var viewport = Sheet.Root!.Element(Maui + "Grid")!;
        ((string?)viewport.Attribute("Padding")).Should().BeNull(
            "padding outside the gesture owner passes top-edge drags to the reader");
        var handle = viewport.Elements(Maui + "VerticalStackLayout").Single();
        ((string?)handle.Attribute("Padding")).Should().Be("16,12,16,0");
        handle.Element(Maui + "VerticalStackLayout.GestureRecognizers")!.Elements(Maui + "PanGestureRecognizer").Should().ContainSingle();
    }

    [Fact]
    public void Perush_row_supports_tapping_the_name_and_remaining_row_area()
    {
        XNamespace controls = "clr-namespace:BibleOnSite.Controls";
        var row = Sheet.Descendants(Maui + "DataTemplate").Single().Element(controls + "TappableView");
        row.Should().NotBeNull("the complete perush row toggles selection through the accessible tappable host (#3252)");
        ((string?)row!.Attribute("Activated")).Should().Be("OnPerushRowTapped");
        row.Element(controls + "TappableView.IsEnabled").Should().NotBeNull(
            "an over-limit perush stays visible but cannot be toggled");
    }

    [Fact]
    public void Perush_checkbox_is_a_display_only_indicator_inside_the_row()
    {
        var checkBox = Sheet.Descendants(Maui + "DataTemplate").Single().Descendants(Maui + "CheckBox")
            .Single(e => (string?)e.Attribute("AutomationId") == "PerushCheckBox");
        ((string?)checkBox.Attribute("InputTransparent")).Should().Be("True",
            "an interactive CheckBox inside the row's WinUI Button would double-toggle: " +
            "CheckedChanged plus the Button's Click, which fires even for pointer input the child handled");
        ((string?)checkBox.Attribute("CheckedChanged")).Should().Be("OnPerushCheckboxChanged",
            "the bound display still reconciles through the same handler");
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
