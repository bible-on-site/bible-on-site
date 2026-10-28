using System.Runtime.InteropServices;
using Foundation;
using Microsoft.Maui.Graphics;
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
public class HtmlViewHandler : ViewHandler<HtmlView, ViewportTextView>
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
        [nameof(HtmlView.SearchMatchStart)] = (handler, _) => handler.UpdateMatchHighlight(),
        [nameof(HtmlView.SearchMatchLength)] = (handler, _) => handler.UpdateMatchHighlight()
    };

    // Managed parsing avoids WebKit's nested main-thread run loop. The serial
    // discards stale completions after a cell is rebound or disconnected.
    // The html and its style are compared separately — a joined render key
    // would copy the whole commentary string on every no-change re-render
    // check (each handler connect re-maps every style property).
    private string? _renderedHtml;
    private RenderStyle _renderedStyle;
    private int _renderSerial;
    // Highlighted raw range applied by the search match — removed when the
    // match moves or clears without repainting unrelated backgrounds.
    private NSRange? _matchRange;
    // Immutable snapshot of the text the platform view holds — the off-thread
    // bounding measure works on it so measure passes never typeset the whole
    // commentary on the main thread. Never disposed eagerly: an in-flight
    // bounding may still reference it; GC finalizes the native object.
    private NSAttributedString? _appliedText;
    private int _measureSerial;
    private double _measuredWidth = -1;
    private double _measuredHeight = -1;
    private double _inflightWidth = double.NaN;

    public HtmlViewHandler() : base(PropertyMapper)
    {
    }

    protected override ViewportTextView CreatePlatformView()
    {
        var viewport = new ViewportTextView();
        viewport.TextView.Delegate = new HtmlLinkDelegate(() => VirtualView);
        return viewport;
    }

    private bool ActivateAccessibilityLink(string url)
    {
        if (VirtualView?.DispatchLinkTapped(url).Handled == true) { return true; }
        using var nativeUrl = new NSUrl(url);
        if (nativeUrl is null) { return false; }
        var options = new UIApplicationOpenUrlOptions();
        UIApplication.SharedApplication.OpenUrl(nativeUrl, options, null);
        return true;
    }
    /// <summary>Routes link interaction through HtmlView.LinkTapped.</summary>
    private sealed class HtmlLinkDelegate(Func<HtmlView?> viewProvider) : UITextViewDelegate
    {
#pragma warning disable S1172 // The UIKit delegate signature fixes parameters the decision does not need.
        public override bool ShouldInteractWithUrl(UITextView textView, NSUrl URL, NSRange characterRange, UITextItemInteraction interaction)
#pragma warning restore S1172
        {
            // The Link attribute stores an NSString (non-ASCII slugs fail NSUrl
            // parsing), so the object UIKit hands here can be an NSString in an
            // NSUrl-typed parameter — AbsoluteString is an unrecognized
            // selector on it and crashes. `description` returns the string
            // itself for NSString and the absolute URL for NSUrl.
            var url = URL.Description;
            if (interaction == UITextItemInteraction.InvokeDefaultAction &&
                viewProvider()?.DispatchLinkTapped(url).Handled == true)
            {
                // We handled the tap — UIKit must not open the URL too.
                return false;
            }
            return true;
        }
    }

    protected override void ConnectHandler(ViewportTextView platformView)
    {
        // A reconnect gets a fresh UITextView: invalidate the render cache so the
        // property mapper re-renders, and discard completions targeted at the
        // previous platform view.
        _renderedHtml = null;
        _appliedText = null;
        Interlocked.Increment(ref _renderSerial);
        ResetMeasurement();
        base.ConnectHandler(platformView);
        platformView.ActivateLink = ActivateAccessibilityLink;
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(ViewportTextView platformView)
    {
        // MAUI clears its platform reference before this callback. Invalidate
        // every queued parse before it can apply to a recycled commentary cell.
        Interlocked.Increment(ref _renderSerial);
        ResetMeasurement();
        _renderedHtml = null;
        _matchRange = null;
        _appliedText = null;
        VirtualView.HtmlContentChanged -= OnHtmlContentChanged;
        VirtualView.StyleChanged -= OnStyleChanged;
        platformView.ActivateLink = null;
        platformView.StopTracking();
        base.DisconnectHandler(platformView);
    }

    private readonly record struct RenderStyle(
        HtmlTextAlignment Alignment, HtmlTextDirection Direction,
        double FontSize, double LineHeight, double H1, double H2, double H3);

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
        if (handler.PlatformView is not ViewportTextView viewport || handler.VirtualView is not HtmlView virtualView)
        {
            return;
        }

        var platformView = viewport.TextView;
        var html = virtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            _renderedHtml = null;
            _matchRange = null;
            _appliedText = null;
            Interlocked.Increment(ref _renderSerial);
            ResetMeasurement();
            if (platformView.TextStorage.Length > 0)
            {
                platformView.Text = string.Empty;
                viewport.UpdateDocumentAccessibility();
            }
            return;
        }

        var fontSize = virtualView.EffectiveFontSize;
        var h1Scale = virtualView.H1FontSizeMultiplier;
        var h2Scale = virtualView.H2FontSizeMultiplier;
        var h3Scale = virtualView.H3FontSizeMultiplier;
        var style = new RenderStyle(virtualView.TextAlignment, virtualView.TextDirection,
            fontSize, virtualView.LineHeight, h1Scale, h2Scale, h3Scale);
        if (style == _renderedStyle && string.Equals(html, _renderedHtml, StringComparison.Ordinal))
        {
            return;
        }
        _renderedStyle = style;
        _renderedHtml = html;
        var serial = Interlocked.Increment(ref _renderSerial);
        _appliedText = null;
        ResetMeasurement();
        // Width hint for the parse pass: a recycled cell already knows its
        // width, so the bounding can ride along and the apply needs only one
        // measure invalidation instead of estimate-then-remeasure.
        var widthHint = virtualView.Width;

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
            LineHeightMultiple = (NFloat)virtualView.LineHeight,
            BaseWritingDirection = virtualView.TextDirection switch
            {
                HtmlTextDirection.Rtl => NSWritingDirection.RightToLeft,
                HtmlTextDirection.Ltr => NSWritingDirection.LeftToRight,
                _ => NSWritingDirection.Natural
            }
        };
        var textColor = GetTextColor();
        /* The marker accent is the tint UITextView paints links with — the
           reference color the note-list letters must match. Read on the main
           thread: UIKit views must not be touched from the parse task. */
        var accentColor = platformView.TintColor ?? UIColor.SystemBlue;

        // Clear recycled content before the parsed result arrives. Skipping the
        // assignment on an already-empty storage avoids a textStorage edit +
        // layout invalidation per freshly realized cell.
        if (platformView.TextStorage.Length > 0)
        {
            platformView.Text = string.Empty;
            viewport.UpdateDocumentAccessibility();
        }

        Task.Run(() =>
        {
            if (serial != Volatile.Read(ref _renderSerial))
            {
                paragraphStyle.Dispose();
                textColor.Dispose();
                return;
            }
            var attributedString = HtmlAttributedStringFactory.FromHtml(html, fontSize, h1Scale, h2Scale, h3Scale,
                textColor, accentColor);
            var measuredHeight = -1.0;
            if (attributedString != null)
            {
                var range = new NSRange(0, attributedString.Length);
                attributedString.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle, range);
                if (widthHint > 0)
                {
                    var rect = attributedString.GetBoundingRect(new CGSize(widthHint, NFloat.MaxValue),
                        NSStringDrawingOptions.UsesLineFragmentOrigin | NSStringDrawingOptions.UsesFontLeading,
                        null);
                    measuredHeight = Math.Ceiling(rect.Height);
                }
            }

            MainThread.BeginInvokeOnMainThread(() => ApplyParsedContent(
                platformView, virtualView, serial, html, attributedString, paragraphStyle, textColor,
                widthHint, measuredHeight));
        });
    }

    private void ApplyParsedContent(UITextView platformView, HtmlView virtualView, int serial, string html,
        NSMutableAttributedString? attributedString, NSMutableParagraphStyle paragraphStyle, UIColor textColor,
        double measuredWidth, double measuredHeight)
    {
        try
        {
            var handler = (IElementHandler)this;
            if (serial != Volatile.Read(ref _renderSerial) ||
                !ReferenceEquals((handler.PlatformView as ViewportTextView)?.TextView, platformView) ||
                !ReferenceEquals(handler.VirtualView, virtualView))
            {
                return;
            }
            _matchRange = null;
            _appliedText = null;
            ResetMeasurement();
            if (attributedString != null)
            {
                ApplySearchMatch(virtualView, attributedString);
                // Snapshot before the mutable instance is disposed: measure
                // boundings run on this immutable copy off the main thread.
                _appliedText = (NSAttributedString)attributedString.Copy();
                if (measuredHeight >= 0)
                {
                    _measuredWidth = measuredWidth;
                    _measuredHeight = measuredHeight;
                }
                NativeReaderTrace.Write($"text-apply:start length={attributedString.Length}");
                platformView.AttributedText = attributedString;
                NativeReaderTrace.Write("text-apply:end");
            }
            else
            {
                platformView.Text = html;
                platformView.TextColor = textColor;
                platformView.TextAlignment = paragraphStyle.Alignment;
            }
            ((ViewportTextView)handler.PlatformView!).UpdateDocumentAccessibility();
            // Parsed text arrived after the original empty-cell measure.
            ((IView)virtualView).InvalidateMeasure();
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
            using var highlight = UIColor.SystemYellow.ColorWithAlpha((NFloat)0.45);
            attributedString.AddAttribute(UIStringAttributeKey.BackgroundColor, highlight, range);
            _matchRange = range;
        }
    }

    /// <summary>
    /// Re-applies the match highlight on the already-rendered text — the match
    /// properties can arrive after the async parse completes. Edits attributes
    /// on the live text storage: re-assigning AttributedText re-typeset the
    /// whole commentary per match update on the main thread.
    /// </summary>
    private void UpdateMatchHighlight()
    {
        var handler = (IElementHandler)this;
        if (handler.PlatformView is not ViewportTextView viewport ||
            handler.VirtualView is not HtmlView virtualView ||
            viewport.TextView.TextStorage is not { Length: > 0 } textStorage)
        {
            // Content not rendered yet — ApplyParsedContent applies the match.
            return;
        }
        if (_matchRange is { } previous)
        {
            // The stored range can exceed the storage after a shorter text was
            // applied — clamp before touching attributes.
            var start = Math.Min(previous.Location, textStorage.Length);
            var end = Math.Min(previous.Location + previous.Length, textStorage.Length);
            if (end > start)
            {
                textStorage.RemoveAttribute(UIStringAttributeKey.BackgroundColor, new NSRange(start, end - start));
            }
            _matchRange = null;
        }
        ApplySearchMatch(virtualView, textStorage);
    }

    /// <summary>
    /// Y offset (density-independent units) of the match's line inside the
    /// UITextView — null until the text is laid out.
    /// </summary>
    internal NFloat? GetSearchMatchTopDips()
    {
        if (PlatformView is not { } viewport || VirtualView is not { HasSearchMatch: true } view)
        {
            return null;
        }
        var platformView = viewport.TextView;
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
        return platformView.ConvertRectToView(rect, viewport).Y;
    }

    /// <summary>
    /// Measuring a self-sized UITextView typesets its whole text — on the main
    /// thread, inside the layout pass that asked. With dozens of perush cells
    /// realized in one scene update on a perek swipe, that sum is what pushed
    /// the app past the scene-update watchdog (0x8BADF00D). Bounding an
    /// NSAttributedString is thread-safe, so the bound runs on a background
    /// task and the measure reads the cached height instead of typesetting.
    /// </summary>
    public override Microsoft.Maui.Graphics.Size GetDesiredSize(double widthConstraint, double heightConstraint)
    {
        if (widthConstraint > 0 && !double.IsInfinity(widthConstraint) &&
            _appliedText is { } text)
        {
            if (Math.Abs(widthConstraint - _measuredWidth) < 0.5 && _measuredHeight >= 0)
            {
                return new Microsoft.Maui.Graphics.Size(widthConstraint, _measuredHeight);
            }
            EnsureMeasuredAsync(text, widthConstraint);
            var estimate = _measuredHeight >= 0
                ? _measuredHeight
                : ((IElementHandler)this).VirtualView is HtmlView view
                    ? view.EffectiveFontSize * view.LineHeight
                    : 0;
            return new Microsoft.Maui.Graphics.Size(widthConstraint, estimate);
        }
        return base.GetDesiredSize(widthConstraint, heightConstraint);
    }

    // A recycled cell or new text must not inherit a pending width measurement.
    // Stale completions also cannot clear a newer measurement's pending state.
    private void ResetMeasurement()
    {
        Interlocked.Increment(ref _measureSerial);
        _inflightWidth = double.NaN;
        _measuredWidth = -1;
        _measuredHeight = -1;
    }

    private void EnsureMeasuredAsync(NSAttributedString text, double width)
    {
        if (Math.Abs(_inflightWidth - width) < 0.5)
        {
            return; // A bound for this width is already running.
        }
        _inflightWidth = width;
        var serial = Interlocked.Increment(ref _measureSerial);
        Task.Run(() =>
        {
            NativeReaderTrace.Write($"text-measure:start length={text.Length} width={width}");
            var rect = text.GetBoundingRect(new CGSize(width, NFloat.MaxValue),
                NSStringDrawingOptions.UsesLineFragmentOrigin | NSStringDrawingOptions.UsesFontLeading,
                null);
            NativeReaderTrace.Write($"text-measure:end height={rect.Height}");
            MainThread.BeginInvokeOnMainThread(() =>
            {
                if (serial != Volatile.Read(ref _measureSerial) ||
                    !ReferenceEquals(_appliedText, text))
                {
                    return;
                }
                _inflightWidth = double.NaN;
                _measuredWidth = width;
                _measuredHeight = Math.Ceiling(rect.Height);
                ((IView?)VirtualView)?.InvalidateMeasure();
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
