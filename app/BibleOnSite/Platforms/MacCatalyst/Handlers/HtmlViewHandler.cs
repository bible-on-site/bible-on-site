using Foundation;
using Microsoft.Maui.Handlers;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
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

    // NSAttributedString's NSHTML import is unusable here at any thread level:
    // NSHTMLReader always marshals the actual parse back to the main thread via
    // performSelectorOnMainThread, where the nested WebKit run loop re-enters
    // UICollectionView cell updates and aborts the app (TestFlight incidents
    // F0AF3C74 and 351F87DB). HtmlRuns converts the markup with a managed
    // parser instead — no WebKit, no hidden main-thread work.
    // _renderSerial still invalidates stale parses after new content.
    private string? _renderedHtml;
    private int _renderSerial;

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
        // property mapper re-renders, and discard stale completions.
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

        var fontSize = VirtualView.EffectiveFontSize;
        var h1Scale = VirtualView.H1FontSizeMultiplier;
        var h2Scale = VirtualView.H2FontSizeMultiplier;
        var h3Scale = VirtualView.H3FontSizeMultiplier;
        var renderKey = $"{VirtualView.TextAlignment}|{VirtualView.TextDirection}|" +
            $"{fontSize}|{VirtualView.LineHeight}|{h1Scale}|{h2Scale}|{h3Scale}|{html}";
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
            // The WebKit stylesheet set `dir` on the document; keep the same
            // base writing direction so mixed-direction runs bidi-resolve alike.
            BaseWritingDirection = VirtualView.TextDirection switch
            {
                HtmlTextDirection.Ltr => NSWritingDirection.LeftToRight,
                HtmlTextDirection.Rtl => NSWritingDirection.RightToLeft,
                _ => NSWritingDirection.Natural
            }
        };
        var textColor = GetTextColor();
        var rtl = VirtualView.TextDirection == HtmlTextDirection.Rtl;

        // Clear recycled content before the parsed result arrives.
        PlatformView.Text = string.Empty;

        Task.Run(() =>
        {
            // Skip the conversion entirely when the bound content already moved on.
            if (serial != _renderSerial)
            {
                return;
            }
            var attributedString = HtmlAttributedStringFactory.FromHtml(html, fontSize, h1Scale, h2Scale, h3Scale);
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
                    // Fallback to plain text
                    PlatformView.Text = html;
                    PlatformView.TextColor = textColor;
                }
                if (rtl)
                {
                    // Set text direction
                    PlatformView.TextAlignment = UITextAlignment.Right;
                }
                // The cell was measured while the text view was empty; re-measure
                // now that the rendered content has arrived.
                VirtualView.InvalidateMeasure();
            });
        });
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
