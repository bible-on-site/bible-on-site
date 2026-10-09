using Foundation;
using Microsoft.Maui.Handlers;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using UIKit;
using CoreGraphics;

namespace BibleOnSite.Handlers;

/// <summary>
/// iOS handler for HtmlView control.
/// Renders managed HTML text runs in UITextView, including RTL justified paragraphs.
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

    // Managed parsing avoids WebKit's nested main-thread run loop. The serial
    // discards stale completions after a cell is rebound or disconnected.
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
        // property mapper re-renders, and discard completions targeted at the
        // previous platform view.
        _renderedHtml = null;
        Interlocked.Increment(ref _renderSerial);
        base.ConnectHandler(platformView);
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(UITextView platformView)
    {
        // MAUI clears its platform reference before this callback. Invalidate
        // every queued parse before it can apply to a recycled commentary cell.
        Interlocked.Increment(ref _renderSerial);
        _renderedHtml = null;
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
        var handler = (IElementHandler)this;
        if (handler.PlatformView is not UITextView platformView || handler.VirtualView is not HtmlView virtualView)
        {
            return;
        }

        var html = virtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            _renderedHtml = null;
            Interlocked.Increment(ref _renderSerial);
            platformView.Text = string.Empty;
            return;
        }

        var fontSize = virtualView.EffectiveFontSize;
        var h1Scale = virtualView.H1FontSizeMultiplier;
        var h2Scale = virtualView.H2FontSizeMultiplier;
        var h3Scale = virtualView.H3FontSizeMultiplier;
        var renderKey = $"{virtualView.TextAlignment}|{virtualView.TextDirection}|{fontSize}|{virtualView.LineHeight}|{h1Scale}|{h2Scale}|{h3Scale}|{html}";
        if (renderKey == _renderedHtml)
        {
            return;
        }
        _renderedHtml = renderKey;
        var serial = Interlocked.Increment(ref _renderSerial);

        var paragraphStyle = new NSMutableParagraphStyle
        {
            Alignment = virtualView.TextAlignment switch
            {
                HtmlTextAlignment.Center => UITextAlignment.Center,
                HtmlTextAlignment.End => virtualView.TextDirection == HtmlTextDirection.Rtl
                    ? UITextAlignment.Left : UITextAlignment.Right,
                HtmlTextAlignment.Justify => UITextAlignment.Justified,
                _ => virtualView.TextDirection == HtmlTextDirection.Rtl
                    ? UITextAlignment.Right : UITextAlignment.Left
            },
            LineHeightMultiple = (nfloat)virtualView.LineHeight,
            BaseWritingDirection = virtualView.TextDirection switch
            {
                HtmlTextDirection.Rtl => NSWritingDirection.RightToLeft,
                HtmlTextDirection.Ltr => NSWritingDirection.LeftToRight,
                _ => NSWritingDirection.Natural
            }
        };
        var textColor = GetTextColor();

        // Clear recycled content before the parsed result arrives.
        platformView.Text = string.Empty;

        Task.Run(() =>
        {
            if (serial != Volatile.Read(ref _renderSerial))
            {
                paragraphStyle.Dispose();
                textColor.Dispose();
                return;
            }
            var attributedString = HtmlAttributedStringFactory.FromHtml(html, fontSize, h1Scale, h2Scale, h3Scale);
            if (attributedString != null)
            {
                var range = new NSRange(0, attributedString.Length);
                attributedString.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle, range);
                attributedString.AddAttribute(UIStringAttributeKey.ForegroundColor, textColor, range);
            }

            MainThread.BeginInvokeOnMainThread(() => ApplyParsedContent(
                platformView, virtualView, serial, html, attributedString, paragraphStyle, textColor));
        });
    }

    private void ApplyParsedContent(UITextView platformView, HtmlView virtualView, int serial, string html,
        NSMutableAttributedString? attributedString, NSMutableParagraphStyle paragraphStyle, UIColor textColor)
    {
        try
        {
            var handler = (IElementHandler)this;
            if (serial != Volatile.Read(ref _renderSerial) ||
                !ReferenceEquals(handler.PlatformView, platformView) ||
                !ReferenceEquals(handler.VirtualView, virtualView))
            {
                return;
            }
            if (attributedString != null)
            {
                platformView.AttributedText = attributedString;
            }
            else
            {
                platformView.Text = html;
                platformView.TextColor = textColor;
                platformView.TextAlignment = paragraphStyle.Alignment;
            }
            // Parsed text arrived after the original empty-cell measure.
            virtualView.InvalidateMeasure();
        }
        finally
        {
            attributedString?.Dispose();
            paragraphStyle.Dispose();
            textColor.Dispose();
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
