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
/// הורדה → מוריד… → הסרה lifecycle. The authored ExtensionPacksView.xaml item
/// template is parsed and instantiated as real MAUI layout objects bound to a
/// real <see cref="RecitationBookChoice"/> - the full row, not just the strip:
/// the parent VerticalStackLayout measures the FlexLayout exactly like the
/// page does (production sets no width request - the flex engine fills short
/// of the row) and anchors it per its authored HorizontalOptions under the
/// page's RTL flow direction. Painted insets therefore come from the actual
/// container contract, the actual XAML values and the shared
/// StackLayout/FlexLayout arrange - not a margin string comparison and not a
/// hand-copied tree. (The dev/e2e app cannot reach these rows: without the
/// packaged recitation catalog the view model surfaces a retry status and no
/// book rows materialize.)
/// </summary>
public class ExtensionPacksLayoutTests
{
    private const double RowWidth = 360;
    private const double RowHeight = 120;
    private const double Tolerance = 0.01;

    /// <summary>
    /// Painted distance of the action's border edge from the row's end edge:
    /// the authored 8-unit margin. JustifyContent="End" anchors each action's
    /// margin box flush to the strip's end edge, and the strip's end edge
    /// anchors flush to the row's end edge, so exactly the designed margin
    /// remains painted - whatever width the flex engine measured for the
    /// strip lands on its start side.
    /// </summary>
    private const double SlotInset = 8;

    /// <summary>Deterministic paint size for leaf views - isolates placement from text metrics.</summary>
    private static readonly Size LeafSize = new(96, 36);
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";

    /// <summary>
    /// The real row template - the DataTemplate root that parents the action
    /// strip - parsed from the shipped XAML file next to the test assembly.
    /// </summary>
    private static readonly Lazy<XElement> RowElement = new(() =>
    {
        var baseDir = Path.GetDirectoryName(typeof(ExtensionPacksLayoutTests).Assembly.Location)!;
        var path = Path.GetFullPath(Path.Join(baseDir, "..", "..", "..", "..",
            "BibleOnSite", "Controls", "ExtensionPacksView.xaml"));
        var doc = XDocument.Load(path);
        return doc.Descendants(Maui + "FlexLayout")
            .Single(flex => flex.Descendants(Maui + "Button")
                .Any(b => b.Attribute("AutomationId")?.Value == "DownloadBookButton"))
            .Parent!;
    });

    /// <summary>
    /// Deterministic measured size via a stub handler - the headless measure
    /// path resolves DesiredSize through <c>IViewHandler.GetDesiredSize</c>.
    /// </summary>
    private static void StubHandler(View view, Size? size = null)
    {
        var handler = new Mock<IViewHandler>();
        handler.Setup(h => h.GetDesiredSize(It.IsAny<double>(), It.IsAny<double>()))
            .Returns(size ?? LeafSize);
        view.Handler = handler.Object;
    }

    /// <summary>
    /// Routes a nested layout's measure/arrange through its real layout
    /// manager, the path a platform handler would take: IView.Measure resolves
    /// DesiredSize via the handler and IView.Arrange delegates to
    /// PlatformArrange, and the platform LayoutHandler forwards both to the
    /// cross-platform layout. Nothing is faked - the manager still measures
    /// and places every child for real.
    /// </summary>
    private static void StubHandler(Layout layout)
    {
        var handler = new Mock<IViewHandler>();
        handler.Setup(h => h.GetDesiredSize(It.IsAny<double>(), It.IsAny<double>()))
            .Returns((double w, double h) => ((ICrossPlatformLayout)layout).CrossPlatformMeasure(w, h));
        handler.Setup(h => h.PlatformArrange(It.IsAny<Rect>()))
            .Callback<Rect>(rect => ((ICrossPlatformLayout)layout).CrossPlatformArrange(rect));
        layout.Handler = handler.Object;
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

    /// <summary>MAUI alignment shorthand: Start/Center/End/Fill with an optional AndExpand.</summary>
    private static LayoutOptions ParseLayoutOptions(string value) =>
        (LayoutOptions)new LayoutOptionsConverter().ConvertFromInvariantString(value)!;

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
    /// Builds the real row for one book: the parsed item-template root keeps its
    /// authored padding/spacing and every descendant keeps its authored margin,
    /// alignment and bound visibility. The strip keeps its authored
    /// HorizontalOptions and is measured by the real layout managers inside
    /// the row's full width - nothing is pinned, so the parent stack's end
    /// anchor does the placement exactly like the page does.
    /// </summary>
    private static VerticalStackLayout ArrangeRow(RecitationBookChoice book, double width = RowWidth)
    {
        var source = RowElement.Value;
        var row = new VerticalStackLayout
        {
            Padding = source.Attribute("Padding")?.Value is { } padding
                ? ParseThickness(padding) : new Thickness(0),
            Spacing = double.Parse(source.Attribute("Spacing")?.Value ?? "0"),
            // The hosting page sets FlowDirection="RightToLeft" (ExtensionPacksPage.xaml)
            // before the template instantiates. Property propagation does not run
            // headless and the flex engine reads direction as children attach, so
            // set it in the initializer - before any child is added.
            FlowDirection = FlowDirection.RightToLeft,
        };
        foreach (var child in source.Elements())
        {
            row.Children.Add(BuildChild(child, book));
        }

        // Headless: the platform-driven arrange never runs, so drive the
        // cross-platform layout entry points the handlers would call - the
        // real StackLayoutManager and FlexLayoutManager measure and place
        // every child.
        var layout = (ICrossPlatformLayout)row;
        layout.CrossPlatformMeasure(width, RowHeight);
        layout.CrossPlatformArrange(new Rect(0, 0, width, RowHeight));
        return row;
    }

    private static View BuildChild(XElement source, RecitationBookChoice book) => source.Name.LocalName switch
    {
        "VerticalStackLayout" => BuildStack(source, book),
        "FlexLayout" => BuildStrip(source, book),
        "Label" => Leaf(source, book, new Label { Text = source.Attribute("Text")?.Value }),
        "Button" => Leaf(source, book, new Button
        {
            Text = source.Attribute("Text")?.Value,
            AutomationId = source.Attribute("AutomationId")?.Value,
        }),
        _ => throw new InvalidOperationException($"unexpected row child {source.Name}")
    };

    private static VerticalStackLayout BuildStack(XElement source, RecitationBookChoice book)
    {
        var stack = new VerticalStackLayout
        {
            Spacing = double.Parse(source.Attribute("Spacing")?.Value ?? "0"),
            FlowDirection = FlowDirection.RightToLeft,
        };
        StubHandler(stack);
        foreach (var child in source.Elements())
        {
            stack.Children.Add(BuildChild(child, book));
        }
        return stack;
    }

    /// <summary>Instantiates the action strip exactly as authored - including its own HorizontalOptions.</summary>
    private static FlexLayout BuildStrip(XElement source, RecitationBookChoice book)
    {
        var strip = new FlexLayout
        {
            Direction = Enum.Parse<FlexDirection>(source.Attribute("Direction")?.Value ?? "Row"),
            Wrap = Enum.Parse<FlexWrap>(source.Attribute("Wrap")?.Value ?? "NoWrap"),
            JustifyContent = Enum.Parse<FlexJustify>(source.Attribute("JustifyContent")?.Value ?? "Start"),
            HorizontalOptions = source.Attribute("HorizontalOptions")?.Value is { } options
                ? ParseLayoutOptions(options) : LayoutOptions.Fill,
            FlowDirection = FlowDirection.RightToLeft,
        };
        StubHandler(strip);
        foreach (var child in source.Elements())
        {
            strip.Children.Add(BuildChild(child, book));
        }
        return strip;
    }

    /// <summary>Applies the authored margin and bound visibility, then stubs a deterministic size.</summary>
    private static TView Leaf<TView>(XElement source, RecitationBookChoice book, TView view)
        where TView : View
    {
        if (source.Attribute("Margin")?.Value is { } margin)
        {
            view.Margin = ParseThickness(margin);
        }
        view.IsVisible = BoundVisibility(source, book);
        // Distinct deterministic sizes keep the partial state ordering observable.
        StubHandler(view, view switch
        {
            Label => new Size(64, 20),
            Button { AutomationId: "RemoveBookButton" } => new Size(64, 36),
            _ => LeafSize,
        });
        return view;
    }

    /// <summary>Every view inside the row, depth-first.</summary>
    private static IEnumerable<View> Descendants(Layout root)
    {
        foreach (var child in root.Children.OfType<View>())
        {
            yield return child;
            if (child is Layout layout)
            {
                foreach (var view in Descendants(layout))
                {
                    yield return view;
                }
            }
        }
    }

    /// <summary>Horizontal distance from the view's painted frame to the tree root, in row units.</summary>
    private static double AbsoluteX(VisualElement view)
    {
        var x = view.Frame.X;
        for (var parent = view.Parent; parent is VisualElement visual; parent = visual.Parent)
        {
            x += visual.Frame.X;
        }
        return x;
    }

    /// <summary>The action strip, a direct child of the parsed row.</summary>
    private static FlexLayout Strip(Layout row) => row.Children.OfType<FlexLayout>().Single();

    /// <summary>
    /// Painted inset from the row edge the strip is anchored to. The anchored
    /// edge is read off the strip's own frame rather than assumed: under the
    /// page's RTL flow direction "end" is wherever the stack put it.
    /// </summary>
    private static double EndInset(VisualElement action, Layout strip, double rowWidth)
    {
        var stripX = AbsoluteX(strip);
        var endIsLeft = stripX < rowWidth - (stripX + strip.Width);
        var actionX = AbsoluteX(action);
        return endIsLeft ? actionX : rowWidth - (actionX + action.Width);
    }

    private static View? Action(Layout row, string automationId) =>
        Descendants(row).FirstOrDefault(v => v.AutomationId == automationId && v.IsVisible);


    [Fact]
    public void SingleAction_EndInset_IsIdenticalForDownloadAndRemove()
    {
        var downloadRow = ArrangeRow(Book(available: 3, installed: 0));
        var download = Action(downloadRow, "DownloadBookButton")
            ?? throw new InvalidOperationException("הורדה button not visible for an uninstalled book");
        var downloadInset = EndInset(download, Strip(downloadRow), RowWidth);

        var removeRow = ArrangeRow(Book(available: 3, installed: 3));
        var remove = Action(removeRow, "RemoveBookButton")
            ?? throw new InvalidOperationException("הסרה button not visible for an installed book");
        var removeInset = EndInset(remove, Strip(removeRow), RowWidth);

        removeInset.Should().BeApproximately(downloadInset, Tolerance,
            "the הסרה action must occupy the same end-anchored slot הורדה used (#3264)");
        downloadInset.Should().BeApproximately(SlotInset, Tolerance,
            "the action keeps the authored margin inset from the row's end edge rather than touching it");
        Strip(downloadRow).Width.Should().BeLessThan(RowWidth,
            "the strip is measured by the real managers - no width request pins it in production");

        // The production strip is measured without a width request: the shared
        // slot is an end anchor, so the invariant must hold at other row widths too.
        var narrowDownload = ArrangeRow(Book(available: 3, installed: 0), width: 280);
        var narrowRemove = ArrangeRow(Book(available: 3, installed: 3), width: 280);
        var narrowRemoveInset = EndInset(Action(narrowRemove, "RemoveBookButton")!, Strip(narrowRemove), 280);
        var narrowDownloadInset = EndInset(Action(narrowDownload, "DownloadBookButton")!, Strip(narrowDownload), 280);
        narrowRemoveInset.Should().BeApproximately(narrowDownloadInset, Tolerance,
            "the shared slot is width-independent - no width request pins the strip in production");
        narrowDownloadInset.Should().BeApproximately(downloadInset, Tolerance,
            "the end inset itself, not the absolute frame, is what the slot defines");
    }


    [Fact]
    public void PartialInstall_KeepBothActions_WithRemoveInTheSharedSlot()
    {
        var partialRow = ArrangeRow(Book(available: 3, installed: 1));
        var download = Action(partialRow, "DownloadBookButton")
            ?? throw new InvalidOperationException("השלמת הורדה must remain visible on a partial install");
        var remove = Action(partialRow, "RemoveBookButton")
            ?? throw new InvalidOperationException("הסרה must remain visible on a partial install");

        var removeRow = ArrangeRow(Book(available: 3, installed: 3));
        var loneRemove = Action(removeRow, "RemoveBookButton")!;

        EndInset(remove, Strip(partialRow), RowWidth).Should()
            .BeApproximately(EndInset(loneRemove, Strip(removeRow), RowWidth), Tolerance,
                "הסרה keeps the same end anchor whether or not השלמת הורדה sits beside it");

        download.Should().NotBeNull("both actions stay visible on a partial install (#3264)");
    }

    [Fact]
    public void Downloading_Label_UsesTheSameSlotInset()
    {
        var downloadingRow = ArrangeRow(Book(available: 3, installed: 0, downloading: true));
        var progress = Descendants(downloadingRow).OfType<Label>()
            .Single(l => l.Text == "מוריד…" && l.IsVisible);
        var downloadRow = ArrangeRow(Book(available: 3, installed: 0));
        var download = Action(downloadRow, "DownloadBookButton")!;

        EndInset(progress, Strip(downloadingRow), RowWidth).Should()
            .BeApproximately(EndInset(download, Strip(downloadRow), RowWidth), Tolerance,
                "the in-place מוריד… progress label aligns with the action slot it replaces");
    }

    [Fact]
    public void UnavailableBook_RendersNoAction()
    {
        var row = ArrangeRow(Book(available: 0, installed: 0, canDownload: false));

        Action(row, "DownloadBookButton").Should().BeNull();
        Action(row, "RemoveBookButton").Should().BeNull();
        Descendants(Strip(row)).OfType<Label>().Where(l => l.IsVisible)
            .Should().BeEmpty("a book with no recordings shows no action at all");
    }
}
