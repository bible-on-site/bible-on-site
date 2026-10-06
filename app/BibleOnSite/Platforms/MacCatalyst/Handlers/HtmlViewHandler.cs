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

    // NSHTML import runs WebKit synchronously and spins the main run loop, so it is
    // skipped when nothing that affects the output changed (e.g. layout-driven refreshes).
    private string? _renderedHtml;
    // Generation guard: a stale background import must not overwrite newer content
    // when a collection cell is recycled while its parse is still in flight.
    private int _renderGeneration;

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
            _renderedHtml = null;
            _renderGeneration++;
            PlatformView.Text = string.Empty;
            return;
        }

        var styledHtml = WrapWithStyles(html);
        var renderKey = $"{VirtualView.TextAlignment}|{styledHtml}";
        if (renderKey == _renderedHtml)
        {
            return;
        }
        _renderedHtml = renderKey;

        var generation = ++_renderGeneration;
        var alignment = VirtualView.TextAlignment;
        var direction = VirtualView.TextDirection;
        var lineHeight = VirtualView.LineHeight;

        // Drop recycled content while the import runs so a reused cell does not
        // flash a previous pasuk's text.
        PlatformView.Text = string.Empty;
        if (direction == HtmlTextDirection.Rtl)
        {
            PlatformView.TextAlignment = UITextAlignment.Right;
        }

        // NSAttributedString NSHTML import spins the main run loop through WebKit.
        // Run inside UICollectionView cell creation that re-enters collection view
        // layout and hits a UIKit consistency assertion (SIGABRT), so the import
        // must happen off the main thread.
        _ = Task.Run(() => CreateAttributedText(styledHtml, alignment, direction, lineHeight))
            .ContinueWith(task =>
            {
                var attributed = task.Status == TaskStatus.RanToCompletion ? task.Result : null;
                PlatformView.BeginInvokeOnMainThread(() =>
                {
                    if (generation != _renderGeneration || PlatformView == null)
                        return;
                    if (attributed != null)
                    {
                        PlatformView.AttributedText = attributed;
                    }
                    else
                    {
                        PlatformView.Text = html;
                        PlatformView.TextColor = GetTextColor();
                    }
                });
            });
    }

    // Runs on a background thread: builds the styled attributed string without
    // touching PlatformView or VirtualView.
    private NSMutableAttributedString? CreateAttributedText(string styledHtml,
        HtmlTextAlignment alignment, HtmlTextDirection direction, double lineHeight)
    {
        try
        {
            var htmlData = NSData.FromString(styledHtml, NSStringEncoding.Unicode);
            if (htmlData == null || htmlData.Length == 0)
            {
                return null;
            }

            var importParams = new NSDictionary(
                new NSString("DocumentType"), new NSString("NSHTML"),
                new NSString("CharacterEncoding"), NSNumber.FromInt32((int)NSStringEncoding.Unicode));

            NSAttributedString? attributedString = null;

            // NSAttributedString HTML import uses WebKit internally and can throw
            // unhandled ObjC exceptions (SIGABRT) that bypass C# try-catch.
            // Temporarily disable ThrowOnInitFailure to convert these into null returns.
            var previousThrowSetting = ObjCRuntime.Class.ThrowOnInitFailure;
            ObjCRuntime.Class.ThrowOnInitFailure = false;
            try
            {
                NSError? error = null;
#pragma warning disable CS0618
                attributedString = new NSAttributedString(htmlData, importParams, out _, ref error!);
#pragma warning restore CS0618
                if (error != null)
                {
                    System.Diagnostics.Debug.WriteLine($"HtmlView NSAttributedString error: {error.LocalizedDescription}");
                    attributedString = null;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"HtmlView NSAttributedString init exception: {ex.Message}");
                attributedString = null;
            }
            finally
            {
                ObjCRuntime.Class.ThrowOnInitFailure = previousThrowSetting;
            }

            if (attributedString == null)
            {
                return null;
            }

            var mutableString = new NSMutableAttributedString(attributedString);

            var paragraphStyle = new NSMutableParagraphStyle
            {
                Alignment = alignment switch
                {
                    HtmlTextAlignment.Center => UITextAlignment.Center,
                    HtmlTextAlignment.End => direction == HtmlTextDirection.Rtl
                        ? UITextAlignment.Left : UITextAlignment.Right,
                    HtmlTextAlignment.Justify => UITextAlignment.Justified,
                    _ => direction == HtmlTextDirection.Rtl
                        ? UITextAlignment.Right : UITextAlignment.Left
                },
                LineHeightMultiple = (nfloat)lineHeight
            };

            var range = new NSRange(0, mutableString.Length);
            mutableString.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle, range);
            mutableString.AddAttribute(UIStringAttributeKey.ForegroundColor, GetTextColor(), range);

            return mutableString;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler MacCatalyst error: {ex.Message}");
            return null;
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
