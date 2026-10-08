using Foundation;
using Microsoft.Maui.Handlers;
using BibleOnSite.Controls;
using UIKit;
using CoreGraphics;

namespace BibleOnSite.Handlers;

/// <summary>
/// iOS handler for HtmlView control.
/// Uses iOS's UITextView with NSAttributedString for proper HTML/CSS support including text-align justify.
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

    // NSHTML import runs WebKit synchronously and spins the calling thread's run
    // loop. On the main thread that nested loop services pending UICollectionView
    // updates while a cell is being created, re-entering _updateVisibleCellsNow:
    // and crashing with SIGABRT (TestFlight incident F0AF3C74). The import runs on
    // a worker thread instead, and the parsed string is applied back on the main
    // thread. _renderSerial invalidates stale parses when the bound content
    // changes while an earlier import is still in flight.
    private string? _renderedHtml;
    private int _renderSerial;

    // WebKitLegacy is not thread-safe: concurrent off-main imports from
    // multiple cells serialize here. Each parse still spins only its own
    // worker run loop, never the main one.
    private static readonly object ParseLock = new();

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
        // A reconnect gets a fresh UITextView: invalidate the render cache so the
        // property mapper re-renders, and discard completions targeted at the
        // previous platform view.
        _renderedHtml = null;
        _renderSerial++;
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
            _renderSerial++;
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
        var serial = ++_renderSerial;

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
            LineHeightMultiple = (nfloat)VirtualView.LineHeight,
            BaseWritingDirection = VirtualView.TextDirection switch
            {
                HtmlTextDirection.Rtl => NSWritingDirection.RightToLeft,
                HtmlTextDirection.Ltr => NSWritingDirection.LeftToRight,
                _ => NSWritingDirection.Natural
            }
        };
        var textColor = GetTextColor();

        // Clear recycled content before the parsed result arrives.
        PlatformView.Text = string.Empty;

        Task.Run(() =>
        {
            NSMutableAttributedString? attributedString;
            lock (ParseLock)
            {
                // Skip the WebKit import entirely when the bound content already
                // moved on — stale parses must not hold the shared lock.
                if (serial != _renderSerial)
                {
                    return;
                }
                attributedString = ParseHtml(styledHtml);
            }
            if (attributedString != null)
            {
                var range = new NSRange(0, attributedString.Length);
                attributedString.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle, range);
                attributedString.AddAttribute(UIStringAttributeKey.ForegroundColor, textColor, range);
            }

            MainThread.BeginInvokeOnMainThread(() =>
            {
                if (PlatformView == null || VirtualView == null || serial != _renderSerial)
                {
                    return;
                }
                if (attributedString != null)
                {
                    PlatformView.AttributedText = attributedString;
                }
                else
                {
                    PlatformView.Text = html;
                    PlatformView.TextColor = textColor;
                    PlatformView.TextAlignment = paragraphStyle.Alignment;
                }
                // The cell was measured while the text view was empty; re-measure
                // now that the rendered content has arrived.
                VirtualView.InvalidateMeasure();
            });
        });
    }

    // Runs off the main thread: NSHTML import spins a nested run loop which is
    // fatal on the main thread inside UICollectionView cell creation.
    private static NSMutableAttributedString? ParseHtml(string styledHtml)
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

            // NSAttributedString HTML import uses WebKit internally and can throw
            // unhandled ObjC exceptions (SIGABRT) that bypass C# try-catch.
            // Temporarily disable ThrowOnInitFailure to convert these into null returns.
            var previousThrowSetting = ObjCRuntime.Class.ThrowOnInitFailure;
            ObjCRuntime.Class.ThrowOnInitFailure = false;
            try
            {
                NSError? error = null;
#pragma warning disable CS0618
                var parsed = new NSAttributedString(htmlData, importParams, out _, ref error!);
#pragma warning restore CS0618
                if (error != null)
                {
                    System.Diagnostics.Debug.WriteLine($"HtmlView NSAttributedString error: {error.LocalizedDescription}");
                    return null;
                }
                return parsed == null ? null : new NSMutableAttributedString(parsed);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"HtmlView NSAttributedString init exception: {ex.Message}");
                return null;
            }
            finally
            {
                ObjCRuntime.Class.ThrowOnInitFailure = previousThrowSetting;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlViewHandler iOS parse error: {ex.Message}");
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
