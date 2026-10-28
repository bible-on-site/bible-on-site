using Microsoft.Maui.Handlers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using BibleOnSite.Controls;
using HtmlAgilityPack;
using WinBrush = Microsoft.UI.Xaml.Media.Brush;
using WinFlowDirection = Microsoft.UI.Xaml.FlowDirection;
using WinSpan = Microsoft.UI.Xaml.Documents.Span;
using WinTextWrapping = Microsoft.UI.Xaml.TextWrapping;

namespace BibleOnSite.Handlers;

/// <summary>
/// Windows handler for HtmlView control.
/// Uses RichTextBlock with HtmlAgilityPack for proper HTML parsing.
/// </summary>
public class HtmlViewHandler : ViewHandler<HtmlView, RichTextBlock>
{
    /// <summary>Compact size shared by sup runs and generated note-list
    /// markers — the same scale HtmlRuns uses, so both resolve identically
    /// under the view's font size (#2723).</summary>
    private const double ScriptScale = 0.75;

    /// <summary>Baseline raise for the compact script runs — the fraction a
    /// CSS <c>vertical-align: super</c> lifts the marker above the text
    /// baseline (#2723).</summary>
    private const double ScriptRaise = 0.33;

    /// <summary>The brush a document <see cref="Hyperlink"/> paints with — the
    /// inline reference's color the note markers must match.</summary>
    private static WinBrush AccentBrush =>
        Microsoft.UI.Xaml.Application.Current?.Resources.TryGetValue("AccentTextFillColorPrimaryBrush", out var brush) == true &&
        brush is WinBrush resolved
            ? resolved
            : new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.DodgerBlue);

    public static IPropertyMapper<HtmlView, HtmlViewHandler> PropertyMapper = new PropertyMapper<HtmlView, HtmlViewHandler>(ViewMapper)
    {
        [nameof(HtmlView.HtmlContent)] = MapHtmlContent,
        [nameof(HtmlView.FontSize)] = MapFontSize,
        [nameof(HtmlView.FontFactor)] = MapFontFactor,
        [nameof(HtmlView.TextAlignment)] = MapTextAlignment,
        [nameof(HtmlView.TextDirection)] = MapTextDirection,
        [nameof(HtmlView.LineHeight)] = MapLineHeight,
        [nameof(HtmlView.H1FontSizeMultiplier)] = MapHeaderStyles,
        [nameof(HtmlView.H2FontSizeMultiplier)] = MapHeaderStyles,
        [nameof(HtmlView.H3FontSizeMultiplier)] = MapHeaderStyles
    };

    public HtmlViewHandler() : base(PropertyMapper)
    {
    }

    protected override RichTextBlock CreatePlatformView()
    {
        return new RichTextBlock
        {
            TextWrapping = WinTextWrapping.Wrap,
            IsTextSelectionEnabled = true
        };
    }

    protected override void ConnectHandler(RichTextBlock platformView)
    {
        base.ConnectHandler(platformView);
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(RichTextBlock platformView)
    {
        VirtualView.HtmlContentChanged -= OnHtmlContentChanged;
        VirtualView.StyleChanged -= OnStyleChanged;
        base.DisconnectHandler(platformView);
    }

    private void OnHtmlContentChanged(object? sender, EventArgs e) => UpdateContent();
    private void OnStyleChanged(object? sender, EventArgs e) => UpdateContent();

    private void UpdateContent()
    {
        if (PlatformView == null || VirtualView == null)
        {
            return;
        }

        PlatformView.Blocks.Clear();

        var html = VirtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            return;
        }

        try
        {
            // Parse HTML using HtmlAgilityPack
            var doc = new HtmlDocument();
            doc.LoadHtml(html);

            var paragraph = new Paragraph
            {
                FontSize = VirtualView.FontSize,
                LineHeight = VirtualView.FontSize * VirtualView.LineHeight,
                TextAlignment = VirtualView.TextAlignment switch
                {
                    HtmlTextAlignment.Center => Microsoft.UI.Xaml.TextAlignment.Center,
                    HtmlTextAlignment.End => VirtualView.TextDirection == HtmlTextDirection.Rtl
                        ? Microsoft.UI.Xaml.TextAlignment.Left
                        : Microsoft.UI.Xaml.TextAlignment.Right,
                    HtmlTextAlignment.Justify => Microsoft.UI.Xaml.TextAlignment.Justify,
                    _ => VirtualView.TextDirection == HtmlTextDirection.Rtl
                        ? Microsoft.UI.Xaml.TextAlignment.Right
                        : Microsoft.UI.Xaml.TextAlignment.Left
                }
            };

            // Set flow direction for RTL
            if (VirtualView.TextDirection == HtmlTextDirection.Rtl)
            {
                PlatformView.FlowDirection = WinFlowDirection.RightToLeft;
            }
            else if (VirtualView.TextDirection == HtmlTextDirection.Ltr)
            {
                PlatformView.FlowDirection = WinFlowDirection.LeftToRight;
            }

            // Parse HTML nodes
            ParseNode(doc.DocumentNode, paragraph.Inlines);
            PlatformView.Blocks.Add(paragraph);
        }
#pragma warning disable S2221 // Deliberate failure boundary: HTML render failure falls back to plain text
        catch (Exception ex) //NOSONAR — HTML render failure falls back to plain text.
        {
#pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler Windows error: {ex.Message}");
            // Fallback to plain text
            var paragraph = new Paragraph { FontSize = VirtualView.FontSize };
            paragraph.Inlines.Add(new Run { Text = html });
            PlatformView.Blocks.Add(paragraph);
        }
    }

    /// <summary>
    /// Routes a hyperlink click through the virtual view's LinkTapped event;
    /// only an unhandled tap opens the URL in the external browser.
    /// </summary>
    private void OnHyperlinkClicked(string href)
    {
        if (VirtualView?.DispatchLinkTapped(href).Handled == true)
        {
            return;
        }

        if (Uri.TryCreate(href, UriKind.Absolute, out var uri))
        {
            _ = Windows.System.Launcher.LaunchUriAsync(uri);
        }
    }

    private void ParseNode(HtmlNode node, InlineCollection inlines, bool inFootnotes = false)
    {
        foreach (var child in node.ChildNodes)
        {
            ParseChild(child, inlines, inFootnotes);
        }
    }

    /// <summary>A footnote item's leading <c>&lt;p&gt;</c> shares the marker's
    /// line (like the website's <c>p:first-child { display: inline }</c>);
    /// later paragraphs keep their normal block break (#2723).</summary>
    private void ParseListItemChildren(HtmlNode li, InlineCollection inlines, bool inFootnotes)
    {
        var firstElementPending = inFootnotes;
        foreach (var child in li.ChildNodes)
        {
            var isFirstParagraph = firstElementPending &&
                child.NodeType == HtmlNodeType.Element &&
                child.Name.Equals("p", StringComparison.OrdinalIgnoreCase);
            if (child.NodeType == HtmlNodeType.Element)
            {
                firstElementPending = false;
            }
            if (isFirstParagraph)
            {
                ParseNode(child, inlines, inFootnotes);
                continue;
            }
            ParseChild(child, inlines, inFootnotes);
        }
    }

    private void ParseChild(HtmlNode child, InlineCollection inlines, bool inFootnotes)
    {
        if (child.NodeType == HtmlNodeType.Text)
        {
            var text = System.Net.WebUtility.HtmlDecode(child.InnerText);
            if (!string.IsNullOrEmpty(text))
            {
                inlines.Add(new Run { Text = text });
            }
        }
        else if (child.NodeType == HtmlNodeType.Element)
        {
            var tagName = child.Name.ToUpperInvariant();
            switch (tagName)
            {
                case "H1":
                case "H2":
                case "H3":
                case "H4":
                case "H5":
                case "H6":
                    // Headers: bold, larger font, own line
                    if (inlines.Count > 0)
                    {
                        inlines.Add(new LineBreak());
                        inlines.Add(new LineBreak()); // Extra spacing before header
                    }
                    var headerBold = new Bold();
                    var headerSpan = new WinSpan
                    {
                        FontSize = tagName switch
                        {
                            "H1" => VirtualView.FontSize * (VirtualView.H1FontSizeMultiplier > 0 ? VirtualView.H1FontSizeMultiplier : 1.8),
                            "H2" => VirtualView.FontSize * (VirtualView.H2FontSizeMultiplier > 0 ? VirtualView.H2FontSizeMultiplier : 1.5),
                            "H3" => VirtualView.FontSize * (VirtualView.H3FontSizeMultiplier > 0 ? VirtualView.H3FontSizeMultiplier : 1.3),
                            "H4" => VirtualView.FontSize * 1.15,
                            "H5" => VirtualView.FontSize * 1.1,
                            _ => VirtualView.FontSize * 1.05
                        }
                    };
                    ParseNode(child, headerSpan.Inlines, inFootnotes);
                    headerBold.Inlines.Add(headerSpan);
                    inlines.Add(headerBold);
                    inlines.Add(new LineBreak());
                    break;

                case "B":
                case "STRONG":
                    var bold = new Bold();
                    ParseNode(child, bold.Inlines, inFootnotes);
                    inlines.Add(bold);
                    break;

                case "I":
                case "EM":
                    var italic = new Italic();
                    ParseNode(child, italic.Inlines, inFootnotes);
                    inlines.Add(italic);
                    break;

                case "U":
                    var underline = new Underline();
                    ParseNode(child, underline.Inlines, inFootnotes);
                    inlines.Add(underline);
                    break;

                case "SUP":
                    /* RichTextBlock inlines carry no baseline shift and
                       Typography superscript needs a font 'sups' glyph
                       Hebrew lacks — host the run in a translated
                       TextBlock so the raise always paints (#2723). The
                       canonical reference is <sup><a> — a linked raised
                       run wears the accent brush like the generated note
                       markers do. */
                    var sup = RaisedTextBlock(ContainsLink(child) ? AccentBrush : null);
                    ParseNode(child, sup.Inlines, inFootnotes);
                    inlines.Add(new InlineUIContainer { Child = sup });
                    break;

                case "BR":
                    inlines.Add(new LineBreak());
                    break;

                case "P":
                case "DIV":
                    // Add line break before block elements
                    if (inlines.Count > 0)
                    {
                        inlines.Add(new LineBreak());
                    }
                    var pSpan = new WinSpan();
                    ParseNode(child, pSpan.Inlines, inFootnotes);
                    inlines.Add(pSpan);
                    inlines.Add(new LineBreak());
                    break;

                case "A":
                    var href = child.GetAttributeValue("href", string.Empty);
                    if (!string.IsNullOrEmpty(href))
                    {
                        var hyperlink = new Hyperlink();
                        // Route the tap through the virtual view's LinkTapped
                        // event; only an unhandled tap opens the browser.
                        hyperlink.Click += (_, _) => OnHyperlinkClicked(href);
                        ParseNode(child, hyperlink.Inlines, inFootnotes);
                        /* A TextBlock hosted in an InlineUIContainer does
                           not inherit the Hyperlink accent — recolor raised
                           references so they still read as links (#2723). */
                        AccentHostedText(hyperlink.Inlines);
                        inlines.Add(hyperlink);
                    }
                    else
                    {
                        ParseNode(child, inlines, inFootnotes);
                    }
                    break;

                case "SPAN":
                    var spanElement = new WinSpan();
                    ParseNode(child, spanElement.Inlines, inFootnotes);
                    inlines.Add(spanElement);
                    break;

                case "UL":
                case "OL":
                    if (inlines.Count > 0)
                    {
                        inlines.Add(new LineBreak());
                    }
                    /* The innermost list owns the marker style — the
                       canonical footnotes list (class="footnotes")
                       generates its items' Hebrew letter markers. */
                    ParseNode(child, inlines, HasClass(child, "footnotes"));
                    break;

                case "LI":
                    inlines.Add(MakeListMarker(child, inFootnotes));
                    ParseListItemChildren(child, inlines, inFootnotes);
                    inlines.Add(new LineBreak());
                    break;

                case "VIDEO":
                case "AUDIO":
                case "SOURCE":
                    break;

                case "IMG":
                    // Skip images for now (RichTextBlock doesn't support inline images easily)
                    inlines.Add(new Run { Text = "[תמונה]" });
                    break;

                case "SCRIPT":
                case "STYLE":
                    break;

                default:
                    // For unknown tags, just process children
                    ParseNode(child, inlines, inFootnotes);
                    break;
            }
        }
    }

    /// <summary>Whether the subtree holds a live anchor — <c>&lt;sup&gt;</c>
    /// wrapped around a reference link paints the whole raised host in the
    /// accent brush, matching the generated note markers (#2723).</summary>
    private static bool ContainsLink(HtmlNode node) =>
        node.DescendantsAndSelf().Any(n =>
            n.NodeType == HtmlNodeType.Element &&
            n.Name.Equals("a", StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrEmpty(n.GetAttributeValue("href", string.Empty)));

    /// <summary>Recolors raised runs nested in a hyperlink to the accent
    /// brush — hosted TextBlocks ignore the Hyperlink's own foreground.</summary>
    private static void AccentHostedText(InlineCollection inlines)
    {
        foreach (var inline in inlines)
        {
            if (inline is InlineUIContainer { Child: Microsoft.UI.Xaml.Controls.TextBlock hosted })
            {
                hosted.Foreground = AccentBrush;
            }
            else if (inline is WinSpan nested)
            {
                AccentHostedText(nested.Inlines);
            }
        }
    }

    /// <summary>Whether the element carries <paramref name="className"/> in
    /// its class list — e.g. the canonical <c>ol class="footnotes"</c>.</summary>
    private static bool HasClass(HtmlNode node, string className) =>
        node.GetAttributeValue("class", string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Contains(className, StringComparer.OrdinalIgnoreCase);

    /// <summary>A compact, raised, accent-colored host matching the inline
    /// footnote reference: the generated marker letters in a footnotes list
    /// wear the same look as the reference sup (#2723). Ordinary items keep
    /// the plain bullet.</summary>
    private Inline MakeListMarker(HtmlNode li, bool footnote)
    {
        if (!footnote)
        {
            return new Run { Text = "• " };
        }
        /* The Hebrew letter travels in data-marker (TanahpediaFootnotes
           normalizes every markup generation), so the note's own number
           shows even for sparse numbering; lists authored without it fall
           back to the item's position like the shared renderer. */
        var marker = li.GetAttributeValue("data-marker", string.Empty);
        if (marker.Length == 0)
        {
            var number = 1;
            if (li.ParentNode != null)
            {
                foreach (var sibling in li.ParentNode.ChildNodes)
                {
                    if (sibling == li)
                    {
                        break;
                    }
                    if (sibling.Name.Equals("li", StringComparison.OrdinalIgnoreCase))
                    {
                        number++;
                    }
                }
            }
            marker = Helpers.GimatryHelper.ToLetters(number);
        }
        var host = RaisedTextBlock(AccentBrush);
        host.Inlines.Add(new Run { Text = $"{marker} " });
        return new InlineUIContainer { Child = host };
    }

    /// <summary>A TextBlock hosted inline, shrunk and lifted off the text
    /// baseline — the deterministic superscript for inline references and
    /// generated note markers alike.</summary>
    private Microsoft.UI.Xaml.Controls.TextBlock RaisedTextBlock(WinBrush? foreground = null)
    {
        var size = VirtualView.FontSize * ScriptScale;
        return new Microsoft.UI.Xaml.Controls.TextBlock
        {
            FontSize = size,
            Foreground = foreground ?? PlatformView.Foreground,
            FontFamily = PlatformView.FontFamily,
            RenderTransform = new TranslateTransform { Y = -(VirtualView.FontSize * ScriptRaise) }
        };
    }

    private static void MapHtmlContent(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapFontSize(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapFontFactor(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapTextAlignment(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapTextDirection(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapLineHeight(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapHeaderStyles(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();
}
