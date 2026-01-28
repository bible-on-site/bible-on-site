using Microsoft.Maui.Handlers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml;
using BibleOnSite.Controls;
using System.Xml.Linq;
using System.Text.RegularExpressions;
using WinFlowDirection = Microsoft.UI.Xaml.FlowDirection;
using WinSpan = Microsoft.UI.Xaml.Documents.Span;
using WinTextWrapping = Microsoft.UI.Xaml.TextWrapping;

namespace BibleOnSite.Handlers;

/// <summary>
/// Windows handler for HtmlView control.
/// Uses RichTextBlock with inline parsing for HTML content with text-align justify support.
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
            // Wrap in a root element for parsing
            var wrappedHtml = $"<root>{html}</root>";

            // Clean up common HTML issues
            wrappedHtml = Regex.Replace(wrappedHtml, @"<br\s*/?>", "<br></br>", RegexOptions.IgnoreCase);

            var element = XElement.Parse(wrappedHtml);
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

            ParseElement(element, paragraph.Inlines);
            PlatformView.Blocks.Add(paragraph);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler Windows error: {ex.Message}");
            // Fallback to plain text
            var paragraph = new Paragraph();
            paragraph.Inlines.Add(new Run { Text = html });
            PlatformView.Blocks.Add(paragraph);
        }
    }

    private void ParseElement(XElement element, InlineCollection inlines)
    {
        foreach (var node in element.Nodes())
        {
            if (node is XText textNode)
            {
                inlines.Add(new Run { Text = textNode.Value });
            }
            else if (node is XElement childElement)
            {
                var tagName = childElement.Name.LocalName.ToUpperInvariant();
                switch (tagName)
                {
                    case "B":
                    case "STRONG":
                        var bold = new Bold();
                        ParseElement(childElement, bold.Inlines);
                        inlines.Add(bold);
                        break;

                    case "I":
                    case "EM":
                        var italic = new Italic();
                        ParseElement(childElement, italic.Inlines);
                        inlines.Add(italic);
                        break;

                    case "U":
                        var underline = new Underline();
                        ParseElement(childElement, underline.Inlines);
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
                        var span = new WinSpan();
                        ParseElement(childElement, span.Inlines);
                        inlines.Add(span);
                        inlines.Add(new LineBreak());
                        break;

                    case "A":
                        var href = childElement.Attribute("href")?.Value;
                        if (!string.IsNullOrEmpty(href))
                        {
                            var hyperlink = new Hyperlink();
                            try
                            {
                                hyperlink.NavigateUri = new Uri(href);
                            }
                            catch { /* Invalid URI */ }
                            ParseElement(childElement, hyperlink.Inlines);
                            inlines.Add(hyperlink);
                        }
                        else
                        {
                            ParseElement(childElement, inlines);
                        }
                        break;

                    case "SPAN":
                        var spanElement = new WinSpan();
                        ParseElement(childElement, spanElement.Inlines);
                        inlines.Add(spanElement);
                        break;

                    case "UL":
                    case "OL":
                        if (inlines.Count > 0)
                        {
                            inlines.Add(new LineBreak());
                        }
                        ParseElement(childElement, inlines);
                        break;

                    case "LI":
                        inlines.Add(new Run { Text = "• " });
                        ParseElement(childElement, inlines);
                        inlines.Add(new LineBreak());
                        break;

                    default:
                        // For unknown tags, just process children
                        ParseElement(childElement, inlines);
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
