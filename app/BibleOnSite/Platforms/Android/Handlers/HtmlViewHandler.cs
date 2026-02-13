using Android.Text;
using Android.Text.Style;
using Android.Widget;
using Java.Lang;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using BibleOnSite.Controls;
using Android.Util;

namespace BibleOnSite.Handlers;

/// <summary>
/// Android handler for HtmlView control.
/// Uses Android's native TextView with Html.FromHtml() for proper CSS support including text-align justify.
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
        [nameof(HtmlView.H3FontSizeMultiplier)] = MapHeaderStyles
    };

    public HtmlViewHandler() : base(PropertyMapper)
    {
    }

    protected override TextView CreatePlatformView()
    {
        var textView = new TextView(Context);
        textView.SetTextColor(GetTextColor());
        return textView;
    }

    /// <summary>
    /// Force the native TextView to measure with EXACTLY the full available width.
    /// By default, MAUI uses AT_MOST which lets the TextView shrink to its text width.
    /// This creates a narrow StaticLayout, and even though MAUI later arranges the view
    /// at full width, the StaticLayout retains the narrow width — making Gravity and
    /// alignment spans ineffective for positioning short RTL text on the right.
    /// Measuring with EXACTLY ensures the StaticLayout fills the available width.
    /// </summary>
    public override Microsoft.Maui.Graphics.Size GetDesiredSize(double widthConstraint, double heightConstraint)
    {
        if (PlatformView == null || VirtualView == null || Context == null)
            return Microsoft.Maui.Graphics.Size.Zero;

        if (!double.IsInfinity(widthConstraint) && widthConstraint > 0)
        {
            var widthPx = (int)Context.ToPixels(widthConstraint);
            var widthSpec = Android.Views.View.MeasureSpec.MakeMeasureSpec(
                widthPx, Android.Views.MeasureSpecMode.Exactly);

            int heightSpec;
            if (double.IsInfinity(heightConstraint) || heightConstraint <= 0)
            {
                heightSpec = Android.Views.View.MeasureSpec.MakeMeasureSpec(
                    0, Android.Views.MeasureSpecMode.Unspecified);
            }
            else
            {
                heightSpec = Android.Views.View.MeasureSpec.MakeMeasureSpec(
                    (int)Context.ToPixels(heightConstraint), Android.Views.MeasureSpecMode.AtMost);
            }

            PlatformView.Measure(widthSpec, heightSpec);
            return new Microsoft.Maui.Graphics.Size(
                Context.FromPixels(PlatformView.MeasuredWidth),
                Context.FromPixels(PlatformView.MeasuredHeight));
        }

        return base.GetDesiredSize(widthConstraint, heightConstraint);
    }

    protected override void ConnectHandler(TextView platformView)
    {
        base.ConnectHandler(platformView);
        VirtualView.HtmlContentChanged += OnHtmlContentChanged;
        VirtualView.StyleChanged += OnStyleChanged;
    }

    protected override void DisconnectHandler(TextView platformView)
    {
        VirtualView.HtmlContentChanged -= OnHtmlContentChanged;
        VirtualView.StyleChanged -= OnStyleChanged;
        base.DisconnectHandler(platformView);
    }

    private void OnHtmlContentChanged(object? sender, EventArgs e) => UpdateContent();
    private void OnStyleChanged(object? sender, EventArgs e) => UpdateContent();

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
        if (PlatformView == null || VirtualView == null)
            return;

        var html = VirtualView.HtmlContent;
        if (string.IsNullOrEmpty(html))
        {
            PlatformView.Text = string.Empty;
            return;
        }

        // Parse HTML using Android's native parser
        ISpanned? spanned;
#pragma warning disable CA1416, CA1422, CS8600 // Platform compatibility, nullable
        if (Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.N)
        {
            spanned = Html.FromHtml(html, FromHtmlOptions.ModeLegacy);
        }
        else
        {
#pragma warning disable CS0618 // Type or member is obsolete
            spanned = Html.FromHtml(html);
#pragma warning restore CS0618
        }
#pragma warning restore CA1416, CA1422, CS8600

        if (spanned != null)
        {
            // Html.FromHtml() appends trailing \n\n for block elements (<p>, <div>),
            // creating visible extra whitespace after each note. Trim it.
            var result = TrimTrailingWhitespace(spanned);
            if (VirtualView.TextDirection == HtmlTextDirection.Rtl)
            {
                // Strip AlignmentSpan spans that Html.FromHtml() injects for <p>/<div>.
                // Prepend RLM to force RTL paragraph direction for the bidi algorithm.
                result = StripAlignmentSpans(result);
                result = PrependRtlMark(result);
            }
            PlatformView.SetText(result, TextView.BufferType.Spannable);
        }
        PlatformView.SetTextColor(GetTextColor());
    }

    /// <summary>
    /// Prepends a Right-to-Left Mark (U+200F) at position 0 of the Spanned text.
    /// This forces the Android bidi algorithm to treat the first paragraph as RTL,
    /// even when the text is very short or starts with neutral characters.
    /// </summary>
    private static ISpanned PrependRtlMark(ISpanned source)
    {
        var builder = new SpannableStringBuilder(source);
        builder.Insert(0, new Java.Lang.String("\u200F"));
        return builder;
    }

    /// <summary>
    /// Removes all AlignmentSpanStandard objects from a Spanned.
    /// Html.FromHtml() adds AlignmentSpan.Standard(ALIGN_NORMAL) for block elements
    /// which can interfere with our alignment settings.
    /// </summary>
    private static ISpanned StripAlignmentSpans(ISpanned source)
    {
        var builder = new SpannableStringBuilder(source);
        var spans = builder.GetSpans(0, builder.Length(),
            Java.Lang.Class.FromType(typeof(AlignmentSpanStandard)));
        if (spans != null)
        {
            foreach (var span in spans)
            {
                builder.RemoveSpan(span);
            }
        }
        return builder;
    }

    /// <summary>
    /// Trims trailing whitespace (especially \n) from a Spanned object.
    /// Html.FromHtml() appends \n\n after block elements, creating unwanted vertical space.
    /// </summary>
    private static ISpanned TrimTrailingWhitespace(ISpanned source)
    {
        int len = source.Length();
        while (len > 0 && char.IsWhiteSpace(source.CharAt(len - 1)))
        {
            len--;
        }
        if (len < source.Length())
        {
            var builder = new SpannableStringBuilder(source, 0, len);
            return builder;
        }
        return source;
    }

    private static void MapHtmlContent(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapFontSize(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetTextSize(ComplexUnitType.Sp, (float)view.EffectiveFontSize);
            handler.UpdateContent();
        }
    }

    private static void MapFontFactor(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetTextSize(ComplexUnitType.Sp, (float)view.EffectiveFontSize);
            handler.UpdateContent();
        }
    }

    private static void MapHeaderStyles(HtmlViewHandler handler, HtmlView view)
        => handler.UpdateContent();

    private static void MapTextAlignment(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView == null) return;

        var isRtl = view.TextDirection == HtmlTextDirection.Rtl;

        if (isRtl)
        {
            // For RTL: use TextAlignment.ViewStart which resolves to physical right
            // when LayoutDirection is RTL (set by MapTextDirection or MAUI's FlowDirection).
            handler.PlatformView.TextAlignment = Android.Views.TextAlignment.ViewStart;
            handler.PlatformView.Gravity = Android.Views.GravityFlags.Start | Android.Views.GravityFlags.Top;
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
                handler.PlatformView.Gravity = Android.Views.GravityFlags.CenterHorizontal | Android.Views.GravityFlags.Top;
            else
                handler.PlatformView.Gravity = Android.Views.GravityFlags.Left | Android.Views.GravityFlags.Top;
        }

        // For justify, use JustificationMode on API 26+.
        // Skip for RTL — JustificationMode.InterWord can override alignment for
        // short/single-line text. RTL alignment is handled via RLM + TextDirection.
#pragma warning disable CA1416 // Platform compatibility
        if (view.TextAlignment == HtmlTextAlignment.Justify && !isRtl &&
            Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.O)
        {
            handler.PlatformView.JustificationMode = Android.Text.JustificationMode.InterWord;
        }
        else if (Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.O)
        {
            handler.PlatformView.JustificationMode = Android.Text.JustificationMode.None;
        }
#pragma warning restore CA1416

        handler.UpdateContent();
    }

    private static void MapTextDirection(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView == null) return;

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
    }

    private static void MapLineHeight(HtmlViewHandler handler, HtmlView view)
    {
        if (handler.PlatformView != null)
        {
            handler.PlatformView.SetLineSpacing(0, (float)view.LineHeight);
            handler.UpdateContent();
        }
    }
}
