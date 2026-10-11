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
        [nameof(HtmlView.H3FontSizeMultiplier)] = MapHeaderStyles,
        [nameof(HtmlView.SearchMatchStart)] = MapSearchMatch,
        [nameof(HtmlView.SearchMatchLength)] = MapSearchMatch
    };

    // Managed parsing avoids WebKit's nested main-thread run loop. The serial
    // discards stale completions after a cell is rebound or disconnected.
    private string? _renderedHtml;
    private int _renderSerial;
    // Highlighted raw range applied by the search match — removed when the
    // match moves or clears without repainting unrelated backgrounds.
    private NSRange? _matchRange;

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
            _matchRange = null;
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
            _matchRange = null;
            if (attributedString != null)
            {
                ApplySearchMatch(virtualView, attributedString);
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

    private void ApplySearchMatch(HtmlView virtualView, NSMutableAttributedString attributedString)
    {
        if (!virtualView.HasSearchMatch)
        {
            return;
        }
        var (start, end) = Helpers.SearchMatch.ToRawRange(
            attributedString.Value?.ToString() ?? string.Empty,
            new Helpers.SearchMatchSpan(virtualView.SearchMatchStart, virtualView.SearchMatchLength));
        end = (int)Math.Min(end, attributedString.Length);
        if (end > start)
        {
            var range = new NSRange(start, end - start);
            using var highlight = UIColor.SystemYellow.ColorWithAlpha((nfloat)0.45);
            attributedString.AddAttribute(UIStringAttributeKey.BackgroundColor, highlight, range);
            _matchRange = range;
        }
    }

    /// <summary>
    /// Re-applies the match highlight on the already-rendered text — the match
    /// properties can arrive after the async parse completes.
    /// </summary>
    private void UpdateMatchHighlight()
    {
        var handler = (IElementHandler)this;
        if (handler.PlatformView is not UITextView platformView ||
            handler.VirtualView is not HtmlView virtualView ||
            platformView.AttributedText is not { Length: > 0 } current)
        {
            // Content not rendered yet — ApplyParsedContent applies the match.
            return;
        }
        using var mutable = new NSMutableAttributedString(current);
        if (_matchRange is { } previous)
        {
            mutable.RemoveAttribute(UIStringAttributeKey.BackgroundColor, previous);
            _matchRange = null;
        }
        ApplySearchMatch(virtualView, mutable);
        platformView.AttributedText = mutable;
    }

    /// <summary>
    /// Y offset (density-independent units) of the match's line inside the
    /// UITextView — null until the text is laid out.
    /// </summary>
    internal nfloat? GetSearchMatchTopDips()
    {
        if (PlatformView is not { } platformView || VirtualView is not { HasSearchMatch: true } view)
        {
            return null;
        }
        var text = platformView.AttributedText?.Value?.ToString();
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }
        var (start, _) = Helpers.SearchMatch.ToRawRange(
            text,
            new Helpers.SearchMatchSpan(view.SearchMatchStart, view.SearchMatchLength));
        var position = platformView.GetPosition(platformView.BeginningOfDocument,
            (nint)Math.Clamp(start, 0, text.Length - 1));
        if (position == null)
        {
            return null;
        }
        var rect = platformView.GetCaretRectForPosition(position);
        // The caret rect is already in text-view coordinates — the container
        // inset is included, do not add it again.
        return rect.Y;
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

    private static void MapSearchMatch(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateMatchHighlight();
}
