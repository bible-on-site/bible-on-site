using System.Reflection;
using System.Xml.Linq;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Layouts;
using Moq;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// #3264 - the per-book קריינות action keeps one end-anchored slot across the
/// הורדה → מוריד… → הסרה lifecycle. The authored ExtensionPacksView.xaml row is
/// parsed and instantiated as real MAUI layout objects bound to a real
/// <see cref="RecitationBookChoice"/>, so the measured painted edges come from
/// the actual XAML values and the shared FlexLayout arrange - not a margin
/// string comparison and not a hand-copied tree. (The dev/e2e app cannot reach
/// these rows: without the packaged recitation catalog the view model surfaces
/// a retry status and no book rows materialize.)
/// </summary>
public class ExtensionPacksLayoutTests
{
    private const double RowWidth = 360;
    private const double RowHeight = 120;
    private const double Tolerance = 0.01;

    /// <summary>Deterministic paint size for leaf views - isolates placement from text metrics.</summary>
    private static readonly Size LeafSize = new(96, 36);
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";

    /// <summary>The real row template, parsed from the shipped XAML file next to the test assembly.</summary>
    private static readonly Lazy<XElement> ActionStripElement = new(() =>
    {
        var baseDir = Path.GetDirectoryName(typeof(ExtensionPacksLayoutTests).Assembly.Location)!;
        var path = Path.GetFullPath(Path.Join(baseDir, "..", "..", "..", "..",
            "BibleOnSite", "Controls", "ExtensionPacksView.xaml"));
        var doc = XDocument.Load(path);
        return doc.Descendants(Maui + "FlexLayout")
            .Single(flex => flex.Descendants(Maui + "Button")
                .Any(b => b.Attribute("AutomationId")?.Value == "DownloadBookButton"));
    });

    /// <summary>
    /// Deterministic measured size via a stub handler - the headless measure
    /// path resolves DesiredSize through <c>IViewHandler.GetDesiredSize</c>.
    /// Layouts get a stub too so their LayoutManager is created.
    /// </summary>
    private static void StubHandler(View view, Size? size = null)
    {
        var handler = new Mock<IViewHandler>();
        handler.Setup(h => h.GetDesiredSize(It.IsAny<double>(), It.IsAny<double>()))
            .Returns(size ?? LeafSize);
        view.Handler = handler.Object;
    }

    private static RecitationBookChoice Book(int available, int installed,
        bool canDownload = true, bool downloading = false) =>
        new()
        {
            Name = "בראשית",
            PerekIds = [1],
            CanDownload = canDownload,
            AvailableCount = available,
            InstalledCount = installed,
            IsDownloading = downloading,
        };

    /// <summary>MAUI thickness shorthand: uniform / horizontal,vertical / l,t,r,b.</summary>
    private static Thickness ParseThickness(string value)
    {
        var parts = value.Split(',').Select(double.Parse).ToArray();
        return parts.Length switch
        {
            1 => new Thickness(parts[0]),
            2 => new Thickness(parts[0], parts[1]),
            4 => new Thickness(parts[0], parts[1], parts[2], parts[3]),
            var n => throw new InvalidDataException($"unsupported Thickness arity {n}")
        };
    }

    /// <summary>Reads the bound boolean flag (e.g. ShowDownload) off the row's view model.</summary>
    private static bool BoundVisibility(XElement element, RecitationBookChoice book)
    {
        var visible = element.Attribute("IsVisible")?.Value;
        if (visible is null)
        {
            return true;
        }
        var path = visible.Trim('{', '}').Replace("Binding ", "");
        return (bool)(typeof(RecitationBookChoice).GetProperty(path)!.GetValue(book) ?? false);
    }

    /// <summary>
    /// Builds the real action strip for one book: the parsed FlexLayout keeps its
    /// authored alignment and every child keeps its authored margin/type, with
    /// visibility driven by the actual bound flag.
    /// </summary>
    private static FlexLayout ArrangeStrip(RecitationBookChoice book, double width = RowWidth)
    {
        var source = ActionStripElement.Value;
        var strip = new FlexLayout
        {
            Direction = Enum.Parse<FlexDirection>(source.Attribute("Direction")?.Value ?? "Row"),
            Wrap = Enum.Parse<FlexWrap>(source.Attribute("Wrap")?.Value ?? "NoWrap"),
            JustifyContent = Enum.Parse<FlexJustify>(source.Attribute("JustifyContent")?.Value ?? "Start"),
            HorizontalOptions = LayoutOptions.End,
            // The production row is full width; fix the strip to it so End anchoring is observable.
            WidthRequest = width,
            // The production shell is RTL - the pack direction the device shows.
            FlowDirection = FlowDirection.RightToLeft,
        };
        foreach (var child in source.Elements())
        {
            View view = child.Name.LocalName switch
            {
                "Label" => new Label { Text = child.Attribute("Text")?.Value },
                "Button" => new Button
                {
                    Text = child.Attribute("Text")?.Value ?? child.Attribute("Text")?.Value,
                    AutomationId = child.Attribute("AutomationId")?.Value,
                },
                _ => throw new InvalidOperationException($"unexpected strip child {child.Name}")
            };
            if (child.Attribute("Margin")?.Value is { } margin)
            {
                view.Margin = ParseThickness(margin);
            }
            view.IsVisible = BoundVisibility(child, book);
            // Distinct deterministic sizes keep the partial state ordering observable.
            StubHandler(view, view switch
            {
                Label => new Size(64, 20),
                Button { AutomationId: "RemoveBookButton" } => new Size(64, 36),
                _ => LeafSize,
            });
            strip.Children.Add(view);
        }

        // Headless: the platform-driven arrange never runs, so drive the
        // cross-platform layout entry points the handlers would call - the
        // real FlexLayoutManager measures and places each child.
        var layout = (ICrossPlatformLayout)strip;
        layout.CrossPlatformMeasure(width, RowHeight);
        // Populate each child's DesiredSize after the manager measure - the
        // arrange pass consumes DesiredSize for the painted frame.
        foreach (var view in strip.Children.OfType<View>())
        {
            ((IView)view).Measure(width, RowHeight);
        }
        layout.CrossPlatformArrange(new Rect(0, 0, width, LeafSize.Height));
        return strip;
    }

    /// <summary>Painted left edge inside the strip - the RTL end-anchored inset.</summary>
    private static double EndInset(VisualElement child) => child.Frame.X;

    private static View? Action(FlexLayout strip, string automationId) =>
        strip.Children.OfType<View>()
            .FirstOrDefault(v => (v as Element)?.AutomationId == automationId && v.IsVisible);


    [Fact]
    public void SingleAction_EndInset_IsIdenticalForDownloadAndRemove()
    {
        var downloadStrip = ArrangeStrip(Book(available: 3, installed: 0));
        var download = Action(downloadStrip, "DownloadBookButton")
            ?? throw new InvalidOperationException("הורדה button not visible for an uninstalled book");
        var downloadInset = EndInset(download);

        var removeStrip = ArrangeStrip(Book(available: 3, installed: 3));
        var remove = Action(removeStrip, "RemoveBookButton")
            ?? throw new InvalidOperationException("הסרה button not visible for an installed book");
        var removeInset = EndInset(remove);

        removeInset.Should().BeApproximately(downloadInset, Tolerance,
            "the הסרה action must occupy the same end-anchored slot הורדה used (#3264)");
        downloadInset.Should().BeGreaterThan(0,
            "the action keeps the designed inset from the row edge rather than touching it");

        // The production strip is measured without a width request: the shared
        // slot is an end anchor, so the invariant must hold at other widths too.
        var narrowDownload = ArrangeStrip(Book(available: 3, installed: 0), width: 280);
        var narrowRemove = ArrangeStrip(Book(available: 3, installed: 3), width: 280);
        var narrowRemoveInset = EndInset(Action(narrowRemove, "RemoveBookButton")!);
        var narrowDownloadInset = EndInset(Action(narrowDownload, "DownloadBookButton")!);
        narrowRemoveInset.Should().BeApproximately(narrowDownloadInset, Tolerance,
            "the shared slot is width-independent - no width request pins the strip in production");
        narrowDownloadInset.Should().BeApproximately(downloadInset, Tolerance,
            "the end inset itself, not the absolute frame, is what the slot defines");
    }


    [Fact]
    public void PartialInstall_KeepBothActions_WithRemoveInTheSharedSlot()
    {
        var partialStrip = ArrangeStrip(Book(available: 3, installed: 1));
        var download = Action(partialStrip, "DownloadBookButton")
            ?? throw new InvalidOperationException("השלמת הורדה must remain visible on a partial install");
        var remove = Action(partialStrip, "RemoveBookButton")
            ?? throw new InvalidOperationException("הסרה must remain visible on a partial install");

        var removeStrip = ArrangeStrip(Book(available: 3, installed: 3));
        var loneRemove = Action(removeStrip, "RemoveBookButton")!;

        EndInset(remove).Should().BeApproximately(EndInset(loneRemove), Tolerance,
            "הסרה keeps the same end anchor whether or not השלמת הורדה sits beside it");

        download.Should().NotBeNull("both actions stay visible on a partial install (#3264)");
    }

    [Fact]
    public void Downloading_Label_UsesTheSameSlotInset()
    {
        var downloadingStrip = ArrangeStrip(Book(available: 3, installed: 0, downloading: true));
        var progress = downloadingStrip.Children.OfType<Label>()
            .Single(l => l.Text == "מוריד…" && l.IsVisible);
        var downloadStrip = ArrangeStrip(Book(available: 3, installed: 0));
        var download = Action(downloadStrip, "DownloadBookButton")!;

        EndInset(progress).Should().BeApproximately(EndInset(download), Tolerance,
            "the in-place מוריד… progress label aligns with the action slot it replaces");
    }

    [Fact]
    public void UnavailableBook_RendersNoAction()
    {
        var strip = ArrangeStrip(Book(available: 0, installed: 0, canDownload: false));

        Action(strip, "DownloadBookButton").Should().BeNull();
        Action(strip, "RemoveBookButton").Should().BeNull();
        strip.Children.OfType<Label>().Where(l => l.IsVisible)
            .Should().BeEmpty("a book with no recordings shows no action at all");
    }
}
