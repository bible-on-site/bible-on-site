#if IOS || MACCATALYST
using System.Runtime.InteropServices;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Graphics;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;

namespace BibleOnSite.Handlers;

// A commentary card can be hundreds of thousands of pixels tall. The ordinary
// Border handler paints a full-size MauiCALayer bitmap; a solid rounded card
// can use Core Animation's background and corner radius without that bitmap.
public sealed class ReaderCellBorderHandler : BorderHandler
{
    private static readonly IPropertyMapper<IBorderView, ReaderCellBorderHandler> ReaderMapper =
        new PropertyMapper<IBorderView, ReaderCellBorderHandler>(Mapper)
        {
            [nameof(IBorderView.Background)] = MapAppearance,
            [nameof(IBorderView.Shape)] = MapAppearance,
            [nameof(IBorderView.Stroke)] = MapAppearance,
            [nameof(IBorderView.StrokeThickness)] = MapAppearance,
            [nameof(IBorderView.StrokeLineCap)] = MapAppearance,
            [nameof(IBorderView.StrokeLineJoin)] = MapAppearance,
            [nameof(IBorderView.StrokeDashPattern)] = MapAppearance,
            [nameof(IBorderView.StrokeDashOffset)] = MapAppearance,
            [nameof(IBorderView.StrokeMiterLimit)] = MapAppearance
        };

    public ReaderCellBorderHandler() : base(ReaderMapper) { }

    private static void MapAppearance(ReaderCellBorderHandler handler, IBorderView border)
    {
        var platformView = handler.PlatformView;
        if (platformView is null) { return; }
        var layer = platformView.Layer;
        if (border.Shape is not RoundRectangle round ||
            round.CornerRadius.TopLeft != round.CornerRadius.TopRight ||
            round.CornerRadius.TopLeft != round.CornerRadius.BottomLeft ||
            round.CornerRadius.TopLeft != round.CornerRadius.BottomRight ||
            border.Background is not (null or SolidPaint) ||
            (border.StrokeThickness > 0 && border.Stroke is not (null or SolidPaint { Color.Alpha: 0 })))
        {
            // Retain standard rendering if a future card uses a gradient,
            // visible stroke, or unequal corners.
            layer.CornerRadius = 0;
            platformView.BackgroundColor = null;
            MapStrokeShape(handler, border);
            return;
        }

        foreach (var background in layer.Sublayers?.OfType<MauiCALayer>() ?? [])
        {
            background.RemoveFromSuperLayer();
        }
        platformView.BackgroundColor = (border.Background as SolidPaint)?.Color?.ToPlatform();
        layer.CornerRadius = (NFloat)round.CornerRadius.TopLeft;
        layer.MasksToBounds = true;
    }
}
#endif
