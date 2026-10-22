using Android.Text;
using Android.Text.Method;
using Android.Text.Style;
using Android.Widget;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using Android.Util;

namespace BibleOnSite.Handlers;

/// <summary>
/// Android handler for HtmlView control.
/// Parses HTML through the shared managed <see cref="HtmlRuns"/> pipeline into
/// a render plan and builds the SpannableString off the UI thread — only the
/// final SetText touches the platform view. The previous per-cell
/// Html.FromHtml parse (tag dispatch + span allocation on the main thread,
/// plus a synchronous exact-width TextView.Measure per bind) was the main
/// scroll-jank path on commentary-heavy perakim; this mirrors the iOS
/// handler's serialized off-thread render + measured-cache design.
/// </summary>
public class HtmlViewHandler : ViewHandler<HtmlView, TextView>
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

    // The html and its style are compared separately — a joined render key
    // would copy the whole commentary string on every no-change re-render
    // check (each handler connect re-maps every style property).
    private string? _renderedHtml;
    private RenderStyle _renderedStyle;
    private int _renderSerial;
    // Highlight span applied by the search match — removed from the live text
    // when the match moves or clears without rebuilding the content.
    private BackgroundColorSpan? _matchSpan;
    // Immutable snapshot of the text the platform view holds — the off-thread
    // StaticLayout measure works on it so measure passes never typeset the
    // whole commentary on the main thread.
    private RenderedContent? _appliedContent;
    private MeasureContext? _measureContext;
    private int _measureSerial;
    private double _measuredWidth = -1;
    private double _measuredHeight = -1;
    private double _inflightWidth = double.NaN;
    // Last StaticLayout built by the background measure — also a fallback for
    // GetSearchMatchTopDips before the platform view lays itself out.
    private Android.Text.Layout? _measuredLayout;

    // Built content is shared across recycled cells: identical notes rebind
    // without re-parsing or re-allocating spans. Bounded by entries and total
    // rendered characters so a sefer-long scroll can't grow it unbounded.
    private static readonly BoundedLruCache<RenderKey, RenderedContent> RenderCache =
        new(maxEntries: 64, maxTotalSize: 1_500_000, measure: content => content.Text.Length);

    /// <summary>Style inputs baked into the rendered spans. Alignment, font size and
    /// line height are view-level (Gravity/TextSize/lineSpacing), so they are
    /// deliberately not part of the render key — changing them never re-parses.</summary>
    private readonly record struct RenderStyle(HtmlTextDirection Direction, double H1, double H2, double H3);

    /// <summary>Cache key: the html plus everything that shapes its rendered spans.</summary>
    private readonly record struct RenderKey(string Html, RenderStyle Style);

    /// <summary>An immutable rendered cell content: the spanned text platforms
    /// copy and annotate per bind. UrlSpan markers stand in for links — the
    /// tap is bound to the owning view at apply time.</summary>
    private sealed record RenderedContent(string Text, ISpanned Spanned);

    /// <summary>
    /// The view state a StaticLayout measure needs, snapshotted on the UI
    /// thread so the layout can be built — and rebuilt at a new width —
    /// entirely off it.
    /// </summary>
    private sealed class MeasureContext
    {
        public required TextPaint Paint { get; init; }
        public required float SpacingAdd { get; init; }
        public required float SpacingMult { get; init; }
        public required BreakStrategy BreakStrategy { get; init; }
        public required HyphenationFrequency Hyphenation { get; init; }
        /// <summary>Null below API 26, where justification mode does not exist.</summary>
        public JustificationMode? Justification { get; init; }
        public required ITextDirectionHeuristic Direction { get; init; }
        /// <summary>Compound padding above+below the layout, added to the measured height.</summary>
        public required int PaddingVertical { get; init; }
        /// <summary>Compound padding left+right, subtracted from the layout width —
        /// mirrors TextView.onMeasure's want = width - horizontal compound padding.</summary>
        public required int PaddingHorizontal { get; init; }
    }

    public HtmlViewHandler() : base(PropertyMapper)
    {
    }

    protected override TextView CreatePlatformView()
    {
        var textView = new TextView(Context);
        textView.SetTextColor(GetTextColor());
        // Required for the TanahLinkSpan spans installed at apply time.
        textView.MovementMethod = LinkMovementMethod.Instance;
        return textView;
    }

    protected override void ConnectHandler(TextView platformView)
    {
        // A reconnect gets a fresh TextView: invalidate the render cache so the
        // property mapper re-renders, and discard completions targeted at the
        // previous platform view.
        _renderedHtml = null;
        _appliedContent = null;
        Interlocked.Increment(ref _renderSerial);
        ResetMeasurement();
        base.ConnectHandler(platformView);
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(TextView platformView)
    {
        // MAUI clears its platform reference before this callback. Invalidate
        // every queued render before it can apply to a recycled commentary cell.
        Interlocked.Increment(ref _renderSerial);
        ResetMeasurement();
        _renderedHtml = null;
        _matchSpan = null;
        _appliedContent = null;
        _measureContext = null;
        VirtualView.HtmlContentChanged -= OnHtmlContentChanged;
        VirtualView.StyleChanged -= OnStyleChanged;
        base.DisconnectHandler(platformView);
    }

    private void OnHtmlContentChanged(object? sender, EventArgs e) => UpdateContent();
    private void OnStyleChanged(object? sender, EventArgs e) => UpdateContent();

    /// <summary>
    /// Force the native TextView to measure with EXACTLY the full available width.
    /// By default, MAUI uses AT_MOST which lets the TextView shrink to its text width.
    /// This creates a narrow StaticLayout, and even though MAUI later arranges the view
    /// at full width, the StaticLayout retains the narrow width — making Gravity and
    /// alignment spans ineffective for positioning short RTL text on the right.
    /// Measuring with EXACTLY ensures the StaticLayout fills the available width.
    /// The rendered text keeps the same contract off the managed measure: an
    /// off-thread StaticLayout at exactly the constrained width produces the
    /// cached height, so the managed measure never typesets on the UI thread.
    /// </summary>
    public override Microsoft.Maui.Graphics.Size GetDesiredSize(double widthConstraint, double heightConstraint)
    {
        if (PlatformView == null || VirtualView == null || Context == null)
        {
            return Microsoft.Maui.Graphics.Size.Zero;
        }

        if (double.IsInfinity(widthConstraint) || widthConstraint <= 0)
        {
            return base.GetDesiredSize(widthConstraint, heightConstraint);
        }

        if (_appliedContent is { } applied)
        {
            if (System.Math.Abs(widthConstraint - _measuredWidth) < 0.5 && _measuredHeight >= 0)
            {
                return new Microsoft.Maui.Graphics.Size(widthConstraint, _measuredHeight);
            }
            EnsureMeasuredAsync(applied, widthConstraint, heightConstraint);
            var estimate = _measuredHeight >= 0
                ? _measuredHeight
                : VirtualView.EffectiveFontSize * VirtualView.LineHeight;
            return new Microsoft.Maui.Graphics.Size(widthConstraint, estimate);
        }

        // Content still rendering (or empty): the platform view holds little or
        // no text, so the synchronous exact measure stays cheap here.
        var widthPx = (int)Context.ToPixels(widthConstraint);
        var widthSpec = Android.Views.View.MeasureSpec.MakeMeasureSpec(
            widthPx, Android.Views.MeasureSpecMode.Exactly);

        var heightSpec = double.IsInfinity(heightConstraint) || heightConstraint <= 0
            ? Android.Views.View.MeasureSpec.MakeMeasureSpec(
                0, Android.Views.MeasureSpecMode.Unspecified)
            : Android.Views.View.MeasureSpec.MakeMeasureSpec(
                (int)Context.ToPixels(heightConstraint), Android.Views.MeasureSpecMode.AtMost);

        PlatformView.Measure(widthSpec, heightSpec);
        return new Microsoft.Maui.Graphics.Size(
            Context.FromPixels(PlatformView.MeasuredWidth),
            Context.FromPixels(PlatformView.MeasuredHeight));
    }

    private Android.Graphics.Color GetTextColor()
    {
        if (Context?.Resources?.Configuration != null)
        {
            var nightMode = Context.Resources.Configuration.UiMode & Android.Content.Res.UiMode.NightMask;
            var isDarkMode = nightMode == Android.Content.Res.UiMode.NightYes;

            return isDarkMode
                ? Android.Graphics.Color.ParseColor("#e0e0e0")
                : Android.Graphics.Color.ParseColor("#1a1a1a");
        }

        return Android.Graphics.Color.ParseColor("#1a1a1a");
    }

    private void UpdateContent()
    {
        var handler = (IElementHandler)this;
        if (handler.PlatformView is not TextView platformView || handler.VirtualView is not HtmlView virtualView)
        {
            return;
        }

        var html = virtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            _renderedHtml = null;
            _matchSpan = null;
            _appliedContent = null;
            _measureContext = null;
            Interlocked.Increment(ref _renderSerial);
            ResetMeasurement();
            if (!string.IsNullOrEmpty(platformView.Text))
            {
                platformView.Text = string.Empty;
            }
            return;
        }

        var style = new RenderStyle(virtualView.TextDirection,
            virtualView.H1FontSizeMultiplier, virtualView.H2FontSizeMultiplier,
            virtualView.H3FontSizeMultiplier);
        if (style == _renderedStyle && string.Equals(html, _renderedHtml, StringComparison.Ordinal))
        {
            return;
        }
        _renderedStyle = style;
        _renderedHtml = html;
        var serial = Interlocked.Increment(ref _renderSerial);
        _appliedContent = null;
        // Drop the previous content's measured/in-flight state before the
        // serial sample so a stale pending measure can't suppress or poison
        // the new content's measurement.
        ResetMeasurement();
        var measureSerial = Volatile.Read(ref _measureSerial);
        var measureContext = _measureContext = CaptureMeasureContext(platformView, virtualView);
        // Width hint for the render pass: a recycled cell already knows its
        // width, so the layout can ride along and the apply needs only one
        // measure invalidation instead of estimate-then-remeasure.
        var widthHint = virtualView.Width;
        var widthHintPx = widthHint > 0 && Context != null ? (int)Context.ToPixels(widthHint) : 0;

        // Clear recycled content before the rendered result arrives. Skipping
        // the assignment on an already-empty view avoids a layout invalidation
        // per freshly realized cell.
        if (!string.IsNullOrEmpty(platformView.Text))
        {
            platformView.Text = string.Empty;
        }

        var key = new RenderKey(html, style);
        Task.Run(() =>
        {
            if (serial != Volatile.Read(ref _renderSerial))
            {
                return;
            }
            var content = RenderCache.GetOrAdd(key, () => RenderContent(key));
            if (serial != Volatile.Read(ref _renderSerial))
            {
                return;
            }
            // The cached spanned is immutable and shared — copy it so this
            // cell's link bindings attach without touching the shared spans.
            var text = new SpannableStringBuilder(content.Spanned);
            ReplaceUrlSpans(text, virtualView);
            Android.Text.Layout? layout = null;
            var measuredHeight = -1.0;
            if (widthHintPx > 0)
            {
                layout = BuildTextLayout(content.Spanned, measureContext, widthHintPx);
                if (Context is { } context)
                {
                    measuredHeight = context.FromPixels(layout.Height + measureContext.PaddingVertical);
                }
            }
            MainThread.BeginInvokeOnMainThread(() => ApplyParsedContent(
                platformView, virtualView, serial, measureSerial, content, text,
                widthHint, measuredHeight, layout));
        });
    }

    /// <summary>
    /// Builds the immutable rendered content for a key: the managed render
    /// plan maps onto Android spans once, then the result is shared read-only
    /// across every cell showing the same note. Runs on a worker thread —
    /// native span objects are plain Java objects, only SetText needs the UI
    /// thread. Links stay as UrlSpan markers; the apply binds them to the view.
    /// </summary>
    private static RenderedContent RenderContent(RenderKey key)
    {
        var plan = HtmlRenderPlan.Build(key.Html,
            key.Style.Direction == HtmlTextDirection.Rtl,
            key.Style.H1, key.Style.H2, key.Style.H3);
        var builder = new SpannableStringBuilder(new Java.Lang.String(plan.Text));
        foreach (var span in plan.Spans)
        {
            const SpanTypes flags = SpanTypes.ExclusiveExclusive;
            if (span.Bold)
            {
                builder.SetSpan(new StyleSpan(Android.Graphics.TypefaceStyle.Bold), span.Start, span.End, flags);
            }
            if (span.Italic)
            {
                builder.SetSpan(new StyleSpan(Android.Graphics.TypefaceStyle.Italic), span.Start, span.End, flags);
            }
            if (span.Underline)
            {
                builder.SetSpan(new UnderlineSpan(), span.Start, span.End, flags);
            }
            if (span.Strikethrough)
            {
                builder.SetSpan(new StrikethroughSpan(), span.Start, span.End, flags);
            }
            if (span.BaselineShift > 0)
            {
                builder.SetSpan(new SuperscriptSpan(), span.Start, span.End, flags);
            }
            else if (span.BaselineShift < 0)
            {
                builder.SetSpan(new SubscriptSpan(), span.Start, span.End, flags);
            }
            if (System.Math.Abs(span.Scale - 1.0) > 0.0001)
            {
                builder.SetSpan(new RelativeSizeSpan((float)span.Scale), span.Start, span.End, flags);
            }
            if (span.Link is { } url)
            {
                builder.SetSpan(new URLSpan(url), span.Start, span.End, flags);
            }
        }
        return new RenderedContent(plan.Text, new SpannableString(builder));
    }

    private void ApplyParsedContent(TextView platformView, HtmlView virtualView,
        int serial, int measureSerial, RenderedContent content, SpannableStringBuilder text,
        double measuredWidth, double measuredHeight, Android.Text.Layout? layout)
    {
        var handler = (IElementHandler)this;
        if (serial != Volatile.Read(ref _renderSerial) ||
            !ReferenceEquals(handler.PlatformView, platformView) ||
            !ReferenceEquals(handler.VirtualView, virtualView))
        {
            return;
        }
        _matchSpan = null;
        _appliedContent = null;
        var measurementCurrent = measureSerial == Volatile.Read(ref _measureSerial);
        ResetMeasurement();
        // Re-capture: style props may have changed between schedule and apply.
        _measureContext = CaptureMeasureContext(platformView, virtualView);
        // Accept the ride-along layout only when no style change invalidated
        // the measurement while it was being built.
        if (measurementCurrent && layout != null && measuredHeight >= 0)
        {
            _measuredWidth = measuredWidth;
            _measuredHeight = measuredHeight;
            _measuredLayout = layout;
        }
        // Read the live match props — they can land while the render ran.
        ApplySearchMatch(virtualView, text);
        _appliedContent = content;
        NativeReaderTrace.Write($"text-apply:start length={content.Text.Length}");
        platformView.SetText(text, TextView.BufferType.Spannable);
        NativeReaderTrace.Write("text-apply:end");
        platformView.SetTextColor(GetTextColor());
        // Rendered text arrived after the original empty-cell measure.
        ((IView)virtualView).InvalidateMeasure();
    }

    /// <summary>
    /// Paints the configured search match with a background span over the raw
    /// rendered range (<see cref="Helpers.SearchMatch.ToRawRange"/> translates
    /// the normalized span, so the leading RLM never shifts it).
    /// </summary>
    private void ApplySearchMatch(HtmlView view, ISpannable text)
    {
        if (!view.HasSearchMatch)
        {
            return;
        }
        var (start, end) = Helpers.SearchMatch.ToRawRange(
            text.ToString() ?? string.Empty,
            new Helpers.SearchMatchSpan(view.SearchMatchStart, view.SearchMatchLength));
        end = System.Math.Min(end, text.Length());
        if (end > start)
        {
            var span = new BackgroundColorSpan(Android.Graphics.Color.Argb(0x55, 0xFF, 0xE0, 0x50));
            text.SetSpan(span, start, end, SpanTypes.ExclusiveExclusive);
            _matchSpan = span;
        }
    }

    /// <summary>
    /// Re-applies the match highlight on the already-rendered text — the match
    /// properties can arrive after the async render completes. Editing the
    /// live spannable (SetText(BufferType.Spannable) keeps markup mutable)
    /// avoids a full content rebuild per match update on the main thread.
    /// </summary>
    private void UpdateMatchHighlight()
    {
        if (PlatformView is not { } platformView ||
            platformView.TextFormatted is not ISpannable text ||
            text.Length() == 0 || VirtualView is not { } view)
        {
            // Content not rendered yet — ApplyParsedContent applies the match.
            return;
        }
        if (_matchSpan is { } previous)
        {
            // The stored range can exceed the text after a shorter content was
            // applied — RemoveSpan is range-safe either way.
            text.RemoveSpan(previous);
            _matchSpan = null;
        }
        ApplySearchMatch(view, text);
        // In-place span edits don't go through SetText — repaint explicitly.
        platformView.Invalidate();
    }

    /// <summary>
    /// Y offset (density-independent units) of the match's line inside the
    /// TextView — null until a text layout exists. Falls back to the last
    /// StaticLayout built by the background measure (same width + layout
    /// params, so identical line tops) when the view has not laid out yet.
    /// </summary>
    internal double? GetSearchMatchTopDips()
    {
        var platformView = PlatformView;
        var layout = platformView?.Layout ?? _measuredLayout;
        if (platformView is null || layout is null ||
            VirtualView is not { HasSearchMatch: true } view ||
            string.IsNullOrEmpty(platformView.Text))
        {
            return null;
        }
        var (start, _) = Helpers.SearchMatch.ToRawRange(
            platformView.Text,
            new Helpers.SearchMatchSpan(view.SearchMatchStart, view.SearchMatchLength));
        var offset = System.Math.Clamp(start, 0, platformView.Text.Length - 1);
        var top = layout.GetLineTop(layout.GetLineForOffset(offset));
        return Context?.FromPixels(top) ?? top;
    }

    // A recycled cell or new text must not inherit a pending width measurement.
    // Stale completions also cannot clear a newer measurement's pending state.
    private void ResetMeasurement()
    {
        Interlocked.Increment(ref _measureSerial);
        _inflightWidth = double.NaN;
        _measuredWidth = -1;
        _measuredHeight = -1;
        _measuredLayout = null;
    }

    /// <summary>View properties changed without touching the rendered content:
    /// re-capture the measure inputs and ask MAUI for a fresh measure pass.</summary>
    private void InvalidateMeasurement()
    {
        if (PlatformView is { } view && VirtualView is { } virtualView)
        {
            _measureContext = CaptureMeasureContext(view, virtualView);
        }
        ResetMeasurement();
        ((IView?)VirtualView)?.InvalidateMeasure();
    }

    private static MeasureContext CaptureMeasureContext(TextView view, HtmlView virtualView)
    {
        return new MeasureContext
        {
            Paint = new TextPaint(view.Paint),
            SpacingAdd = view.LineSpacingExtra,
            SpacingMult = view.LineSpacingMultiplier,
            BreakStrategy = view.BreakStrategy,
            Hyphenation = view.HyphenationFrequency,
            Justification = OperatingSystem.IsAndroidVersionAtLeast(26)
                ? view.JustificationMode
                : null,
            Direction = virtualView.TextDirection switch
            {
                HtmlTextDirection.Rtl => TextDirectionHeuristics.Rtl!,
                HtmlTextDirection.Ltr => TextDirectionHeuristics.Ltr!,
                _ => TextDirectionHeuristics.Locale!
            },
            PaddingVertical = view.CompoundPaddingTop + view.CompoundPaddingBottom,
            PaddingHorizontal = view.CompoundPaddingLeft + view.CompoundPaddingRight
        };
    }

    /// <summary>
    /// Builds the exact layout the TextView would typeset for the applied text
    /// at <paramref name="widthPx"/>: same paint, line spacing, direction
    /// heuristic, break strategy and hyphenation — mirroring the parameters
    /// TextView feeds its internal StaticLayout so cached heights match what
    /// the native measure reports.
    /// </summary>
    private static Android.Text.Layout BuildTextLayout(
        Java.Lang.ICharSequence text, MeasureContext context, int widthPx)
    {
        // TextView.onMeasure subtracts horizontal compound padding before
        // typesetting (want = width - left - right).
        var layoutWidth = System.Math.Max(1, widthPx - context.PaddingHorizontal);
        var builder = StaticLayout.Builder.Obtain(text, 0, text.Length(), context.Paint, layoutWidth)!
            .SetAlignment(Android.Text.Layout.Alignment.AlignNormal!)
            .SetTextDirection(context.Direction)!
            .SetLineSpacing(context.SpacingAdd, context.SpacingMult)!
            .SetIncludePad(true)!
            .SetBreakStrategy(context.BreakStrategy)!
            .SetHyphenationFrequency(context.Hyphenation)!;
        if (OperatingSystem.IsAndroidVersionAtLeast(26) && context.Justification is { } justification)
        {
            builder.SetJustificationMode(justification);
        }
        // Mirror the compat flags TextView feeds its own StaticLayout for this
        // app's targetSdk (fallback line spacing since SDK 28, bounds-for-width
        // since SDK 35) so the cached height matches the native measure.
        if (OperatingSystem.IsAndroidVersionAtLeast(28))
        {
            builder.SetUseLineSpacingFromFallbacks(true);
        }
        if (OperatingSystem.IsAndroidVersionAtLeast(35))
        {
            builder.SetUseBoundsForWidth(true);
        }
        return builder.Build()!;
    }

    private void EnsureMeasuredAsync(RenderedContent content, double width, double heightConstraint)
    {
        if (System.Math.Abs(_inflightWidth - width) < 0.5)
        {
            return; // A layout for this width is already running.
        }
        if (_measureContext is not { } context || Context is not { } displayContext)
        {
            return;
        }
        _inflightWidth = width;
        var serial = Interlocked.Increment(ref _measureSerial);
        var widthPx = (int)displayContext.ToPixels(width);
        var heightCapPx = !double.IsInfinity(heightConstraint) && heightConstraint > 0
            ? (int)displayContext.ToPixels(heightConstraint)
            : -1;
        Task.Run(() =>
        {
            NativeReaderTrace.Write($"text-measure:start length={content.Text.Length} width={width}");
            var layout = BuildTextLayout(content.Spanned, context, widthPx);
            var heightPx = layout.Height + context.PaddingVertical;
            if (heightCapPx > 0)
            {
                heightPx = System.Math.Min(heightPx, heightCapPx);
            }
            NativeReaderTrace.Write($"text-measure:end height={heightPx}");
            MainThread.BeginInvokeOnMainThread(() =>
            {
                if (serial != Volatile.Read(ref _measureSerial) ||
                    !ReferenceEquals(_appliedContent, content))
                {
                    return;
                }
                _inflightWidth = double.NaN;
                _measuredWidth = width;
                _measuredHeight = Context?.FromPixels(heightPx) ?? heightPx;
                _measuredLayout = layout;
                ((IView?)VirtualView)?.InvalidateMeasure();
            });
        });
    }

    /// <summary>
    /// Replaces the render's UrlSpan markers with ClickableSpans that raise the
    /// virtual view's LinkTapped event. When no subscriber marks the tap
    /// handled, the URL opens in the external browser.
    /// </summary>
    private static void ReplaceUrlSpans(SpannableStringBuilder builder, HtmlView? view)
    {
        var spans = builder.GetSpans(0, builder.Length(),
            Java.Lang.Class.FromType(typeof(URLSpan)));
        if (spans == null || spans.Length == 0)
        {
            return;
        }

        foreach (var spanObj in spans)
        {
            if (spanObj is not URLSpan urlSpan || urlSpan.URL is not { } url)
            {
                continue;
            }
            var start = builder.GetSpanStart(urlSpan);
            var end = builder.GetSpanEnd(urlSpan);
            var flags = builder.GetSpanFlags(urlSpan);
            builder.RemoveSpan(urlSpan);
            builder.SetSpan(new TanahLinkSpan(url, view), start, end, flags);
        }
    }

    /// <summary>Link span that routes taps through HtmlView.LinkTapped first.</summary>
    private sealed class TanahLinkSpan(string url, HtmlView? view) : ClickableSpan
    {
        public override void OnClick(Android.Views.View widget)
        {
            if (view?.DispatchLinkTapped(url).Handled == true)
            {
                return;
            }

            try
            {
                widget.Context?.StartActivity(new Android.Content.Intent(
                    Android.Content.Intent.ActionView, Android.Net.Uri.Parse(url)));
            }
            catch (Android.Content.ActivityNotFoundException)
            {
                // No browser available — the tap silently does nothing.
            }
        }
    }

    private static void MapHtmlContent(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapFontSize(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetTextSize(ComplexUnitType.Sp, (float)view.EffectiveFontSize);
            handler.InvalidateMeasurement();
        }
    }

    private static void MapFontFactor(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetTextSize(ComplexUnitType.Sp, (float)view.EffectiveFontSize);
            handler.InvalidateMeasurement();
        }
    }

    private static void MapHeaderStyles(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapTextAlignment(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView == null)
        {
            return;
        }

        var isRtl = view.TextDirection == HtmlTextDirection.Rtl;

        if (isRtl)
        {
            handler.PlatformView.TextAlignment = view.TextAlignment switch
            {
                HtmlTextAlignment.Center => Android.Views.TextAlignment.Center,
                HtmlTextAlignment.End => Android.Views.TextAlignment.ViewEnd,
                _ => Android.Views.TextAlignment.ViewStart
            };
            handler.PlatformView.Gravity = (view.TextAlignment switch
            {
                HtmlTextAlignment.Center => Android.Views.GravityFlags.CenterHorizontal,
                HtmlTextAlignment.End => Android.Views.GravityFlags.End,
                _ => Android.Views.GravityFlags.Start
            }) | Android.Views.GravityFlags.Top;
        }
        else
        {
            handler.PlatformView.TextAlignment = view.TextAlignment switch
            {
                HtmlTextAlignment.Center => Android.Views.TextAlignment.Center,
                HtmlTextAlignment.End => Android.Views.TextAlignment.ViewEnd,
                HtmlTextAlignment.Justify => Android.Views.TextAlignment.TextStart,
                _ => Android.Views.TextAlignment.TextStart
            };

            if (view.TextAlignment == HtmlTextAlignment.Center)
            {
                handler.PlatformView.Gravity = Android.Views.GravityFlags.CenterHorizontal | Android.Views.GravityFlags.Top;
            }
            else
            {
                handler.PlatformView.Gravity = Android.Views.GravityFlags.Left | Android.Views.GravityFlags.Top;
            }
        }

        // Justify complete lines in either direction. TextDirection and the RLM
        // keep short paragraphs and their final line aligned to the RTL start.
#pragma warning disable CA1416 // Platform compatibility
        if (view.TextAlignment == HtmlTextAlignment.Justify &&
            Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.O)
        {
            handler.PlatformView.JustificationMode = Android.Text.JustificationMode.InterWord;
        }
        else if (Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.O)
        {
            handler.PlatformView.JustificationMode = Android.Text.JustificationMode.None;
        }
#pragma warning restore CA1416

        // Alignment lives on the view — no span rebuild needed, but the layout
        // inputs changed so any cached measure is stale.
        handler.InvalidateMeasurement();
    }

    private static void MapTextDirection(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView == null)
        {
            return;
        }

        handler.PlatformView.TextDirection = view.TextDirection switch
        {
            HtmlTextDirection.Ltr => Android.Views.TextDirection.Ltr,
            HtmlTextDirection.Rtl => Android.Views.TextDirection.Rtl,
            _ => Android.Views.TextDirection.Locale
        };

        handler.PlatformView.LayoutDirection = view.TextDirection switch
        {
            HtmlTextDirection.Rtl => Android.Views.LayoutDirection.Rtl,
            HtmlTextDirection.Ltr => Android.Views.LayoutDirection.Ltr,
            _ => Android.Views.LayoutDirection.Locale
        };

        // Re-apply alignment (depends on direction)
        MapTextAlignment(handler, view);
        // Direction is baked into the rendered text (leading RLM) — re-render.
        handler.UpdateContent();
    }

    private static void MapLineHeight(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetLineSpacing(0, (float)view.LineHeight);
            handler.InvalidateMeasurement();
        }
    }
}
