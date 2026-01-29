using Microsoft.Maui.Handlers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml;
using BibleOnSite.Controls;
using HtmlAgilityPack;
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
            return;

        PlatformView.Blocks.Clear();

        var html = VirtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
            return;

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
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler Windows error: {ex.Message}");
            // Fallback to plain text
            var paragraph = new Paragraph { FontSize = VirtualView.FontSize };
            paragraph.Inlines.Add(new Run { Text = html });
            PlatformView.Blocks.Add(paragraph);
        }
    }

    private void ParseNode(HtmlNode node, InlineCollection inlines)
    {
        foreach (var child in node.ChildNodes)
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
                        ParseNode(child, headerSpan.Inlines);
                        headerBold.Inlines.Add(headerSpan);
                        inlines.Add(headerBold);
                        inlines.Add(new LineBreak());
                        break;

                    case "B":
                    case "STRONG":
                        var bold = new Bold();
                        ParseNode(child, bold.Inlines);
                        inlines.Add(bold);
                        break;

                    case "I":
                    case "EM":
                        var italic = new Italic();
                        ParseNode(child, italic.Inlines);
                        inlines.Add(italic);
                        break;

                    case "U":
                        var underline = new Underline();
                        ParseNode(child, underline.Inlines);
                        inlines.Add(underline);
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
                        ParseNode(child, pSpan.Inlines);
                        inlines.Add(pSpan);
                        inlines.Add(new LineBreak());
                        break;

                    case "A":
                        var href = child.GetAttributeValue("href", string.Empty);
                        if (!string.IsNullOrEmpty(href))
                        {
                            var hyperlink = new Hyperlink();
                            try
                            {
                                hyperlink.NavigateUri = new Uri(href);
                            }
                            catch { /* Invalid URI */ }
                            ParseNode(child, hyperlink.Inlines);
                            inlines.Add(hyperlink);
                        }
                        else
                        {
                            ParseNode(child, inlines);
                        }
                        break;

                    case "SPAN":
                        var spanElement = new WinSpan();
                        ParseNode(child, spanElement.Inlines);
                        inlines.Add(spanElement);
                        break;

                    case "UL":
                    case "OL":
                        if (inlines.Count > 0)
                        {
                            inlines.Add(new LineBreak());
                        }
                        ParseNode(child, inlines);
                        break;

                    case "LI":
                        inlines.Add(new Run { Text = "• " });
                        ParseNode(child, inlines);
                        inlines.Add(new LineBreak());
                        break;

                    case "VIDEO":
                        // Show placeholder for video
                        if (inlines.Count > 0) inlines.Add(new LineBreak());
                        inlines.Add(new Run { Text = "[🎬 וידאו]" });
                        inlines.Add(new LineBreak());
                        break;

                    case "AUDIO":
                        // Show placeholder for audio
                        if (inlines.Count > 0) inlines.Add(new LineBreak());
                        inlines.Add(new Run { Text = "[🔊 אודיו]" });
                        inlines.Add(new LineBreak());
                        break;

                    case "IMG":
                        // Skip images for now (RichTextBlock doesn't support inline images easily)
                        inlines.Add(new Run { Text = "[תמונה]" });
                        break;

                    case "SCRIPT":
                    case "STYLE":
                    case "SOURCE":
                        // Skip these entirely
                        break;

                    default:
                        // For unknown tags, just process children
                        ParseNode(child, inlines);
                        break;
                }
            }
        }
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
