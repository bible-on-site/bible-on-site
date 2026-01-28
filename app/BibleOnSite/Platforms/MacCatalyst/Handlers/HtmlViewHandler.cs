using Foundation;
using Microsoft.Maui.Handlers;
using BibleOnSite.Controls;
using UIKit;
using CoreGraphics;

namespace BibleOnSite.Handlers;

/// <summary>
/// MacCatalyst handler for HtmlView control.
/// Uses UITextView with NSAttributedString for proper HTML/CSS support including text-align justify.
/// </summary>
public class HtmlViewHandler : ViewHandler<HtmlView, UITextView>
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

    protected override UITextView CreatePlatformView()
    {
        var textView = new UITextView
        {
            Editable = false,
            ScrollEnabled = false,
            BackgroundColor = UIColor.Clear,
            TextContainerInset = UIEdgeInsets.Zero
        };
        textView.TextContainer.LineFragmentPadding = 0;

        return textView;
    }

    protected override void ConnectHandler(UITextView platformView)
    {
        base.ConnectHandler(platformView);
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(UITextView platformView)
    {
        VirtualView.HtmlContentChanged -= OnHtmlContentChanged;
        VirtualView.StyleChanged -= OnStyleChanged;
        base.DisconnectHandler(platformView);
    }

    private void OnHtmlContentChanged(object? sender, EventArgs e) => UpdateContent();
    private void OnStyleChanged(object? sender, EventArgs e) => UpdateContent();

    private UIColor GetTextColor()
    {
        return UIColor.FromDynamicProvider((traits) =>
            traits.UserInterfaceStyle == UIUserInterfaceStyle.Dark
                ? UIColor.FromRGB(224, 224, 224)
                : UIColor.FromRGB(26, 26, 26));
    }

    private void UpdateContent()
    {
        if (PlatformView == null || VirtualView == null)
            return;

        var html = VirtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            PlatformView.Text = string.Empty;
            return;
        }

        // Wrap content with styling
        var styledHtml = WrapWithStyles(html);

        try
        {
            // Parse HTML using NSAttributedString via import
            var htmlData = NSData.FromString(styledHtml, NSStringEncoding.Unicode);

            var importParams = new NSDictionary(
                new NSString("DocumentType"), new NSString("NSHTML"),
                new NSString("CharacterEncoding"), NSNumber.FromInt32((int)NSStringEncoding.Unicode));

            NSError? error = null;
#pragma warning disable CS0618 // Type or member is obsolete - this constructor still works and is simpler
            var attributedString = new NSAttributedString(htmlData, importParams, out _, ref error!);
#pragma warning restore CS0618

            if (error == null && attributedString != null)
            {
                var mutableString = new NSMutableAttributedString(attributedString);

                // Apply text alignment
                var paragraphStyle = new NSMutableParagraphStyle
                {
                    Alignment = VirtualView.TextAlignment switch
                    {
                        HtmlTextAlignment.Center => UITextAlignment.Center,
                        HtmlTextAlignment.End => VirtualView.TextDirection == HtmlTextDirection.Rtl
                            ? UITextAlignment.Left : UITextAlignment.Right,
                        HtmlTextAlignment.Justify => UITextAlignment.Justified,
                        _ => VirtualView.TextDirection == HtmlTextDirection.Rtl
                            ? UITextAlignment.Right : UITextAlignment.Left
                    },
                    LineHeightMultiple = (nfloat)VirtualView.LineHeight
                };

                var range = new NSRange(0, mutableString.Length);
                mutableString.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle, range);
                mutableString.AddAttribute(UIStringAttributeKey.ForegroundColor, GetTextColor(), range);

                PlatformView.AttributedText = mutableString;
            }
            else
            {
                // Fallback to plain text
                PlatformView.Text = html;
                PlatformView.TextColor = GetTextColor();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler MacCatalyst error: {ex.Message}");
            PlatformView.Text = html;
            PlatformView.TextColor = GetTextColor();
        }

        // Set text direction
        if (VirtualView.TextDirection == HtmlTextDirection.Rtl)
        {
            PlatformView.TextAlignment = UITextAlignment.Right;
        }
    }

    private string WrapWithStyles(string html)
    {
        var textAlign = VirtualView.GetCssTextAlign();
        var direction = VirtualView.GetCssDirection();
        var fontSize = VirtualView.EffectiveFontSize;
        var lineHeight = VirtualView.LineHeight;
        var h1Size = fontSize * VirtualView.H1FontSizeMultiplier;
        var h2Size = fontSize * VirtualView.H2FontSizeMultiplier;
        var h3Size = fontSize * VirtualView.H3FontSizeMultiplier;

        return $@"<!DOCTYPE html>
<html dir=""{direction}"">
<head>
    <meta charset=""UTF-8"">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: {fontSize}px;
            text-align: {textAlign};
            direction: {direction};
            line-height: {lineHeight};
            margin: 0;
            padding: 0;
        }}
        h1 {{ font-size: {h1Size}px; }}
        h2 {{ font-size: {h2Size}px; text-decoration: underline; }}
        h3 {{ font-size: {h3Size}px; text-decoration: underline; }}
        a {{ color: #1976d2; }}
    </style>
</head>
<body>{html}</body>
</html>";
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
