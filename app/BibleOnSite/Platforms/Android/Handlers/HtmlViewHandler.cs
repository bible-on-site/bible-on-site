using Android.Text;
using Android.Widget;
using Microsoft.Maui.Handlers;
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
        // Check if dark mode is enabled via configuration
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

        // Wrap content with styling div
        var styledHtml = WrapWithStyles(html);

        // Parse HTML using Android's native parser
        ISpanned? spanned;
#pragma warning disable CA1416, CA1422, CS8600 // Platform compatibility, nullable
        if (Android.OS.Build.VERSION.SdkInt >= Android.OS.BuildVersionCodes.N)
        {
            spanned = Html.FromHtml(styledHtml, FromHtmlOptions.ModeLegacy);
        }
        else
        {
#pragma warning disable CS0618 // Type or member is obsolete
            spanned = Html.FromHtml(styledHtml);
#pragma warning restore CS0618
        }
#pragma warning restore CA1416, CA1422, CS8600

        if (spanned != null)
        {
            PlatformView.SetText(spanned, TextView.BufferType.Spannable);
        }
        PlatformView.SetTextColor(GetTextColor());
    }

    private string WrapWithStyles(string html)
    {
        // Android's Html.FromHtml() only supports a limited subset of HTML tags.
        // It does NOT support <style>, <html>, <head>, <body>, or CSS.
        // Styling is handled via TextView properties (TextSize, JustificationMode, etc.)
        // We just wrap in a div for direction support.
        var direction = VirtualView.GetCssDirection();
        return $"<div dir=\"{direction}\">{html}</div>";
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

        // For Justify + RTL we use TextAlignment.Gravity so that short/last
        // lines fall back to the Gravity setting (right-aligned).
        // JustificationMode.InterWord only stretches full lines.
        if (view.TextAlignment == HtmlTextAlignment.Justify && isRtl)
        {
            handler.PlatformView.TextAlignment = Android.Views.TextAlignment.Gravity;
            handler.PlatformView.Gravity = Android.Views.GravityFlags.Right | Android.Views.GravityFlags.Top;
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

            if (isRtl)
                handler.PlatformView.Gravity = Android.Views.GravityFlags.Right | Android.Views.GravityFlags.Top;
            else if (view.TextAlignment == HtmlTextAlignment.Center)
                handler.PlatformView.Gravity = Android.Views.GravityFlags.CenterHorizontal | Android.Views.GravityFlags.Top;
            else
                handler.PlatformView.Gravity = Android.Views.GravityFlags.Left | Android.Views.GravityFlags.Top;
        }

        // For justify, use Justification mode on API 26+
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

        // Force native LayoutDirection so Gravity.Right/End resolves correctly
        handler.PlatformView.LayoutDirection = view.TextDirection switch
        {
            HtmlTextDirection.Rtl => Android.Views.LayoutDirection.Rtl,
            HtmlTextDirection.Ltr => Android.Views.LayoutDirection.Ltr,
            _ => Android.Views.LayoutDirection.Locale
        };

        // Re-apply alignment (Gravity + TextAlignment depend on direction)
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
