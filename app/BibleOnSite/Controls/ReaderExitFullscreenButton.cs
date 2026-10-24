using Microsoft.Maui.Controls.Shapes;

namespace BibleOnSite.Controls;

/// <summary>
/// The floating "exit fullscreen" button shared by the reader pages — a
/// draggable circle: tap exits fullscreen, drag repositions it so it can sit
/// out of the reader's way.
/// On Android the drag uses native touch with raw screen coordinates for
/// pixel-perfect tracking; other platforms use MAUI gesture recognizers.
/// </summary>
public class ReaderExitFullscreenButton : Border
{
    /// <summary>Raised on a tap that was not a drag — the page exits fullscreen.</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler? ExitRequested;
#pragma warning restore S3264

    public ReaderExitFullscreenButton()
    {
        AutomationId = "ExitFullScreenButton";
        WidthRequest = 48;
        HeightRequest = 48;
        StrokeShape = new RoundRectangle { CornerRadius = 24 };
        Stroke = Brush.Transparent;
        HorizontalOptions = LayoutOptions.End;
        VerticalOptions = LayoutOptions.End;
        IsVisible = false;
        Shadow = new Shadow
        {
            Brush = Brush.Black,
            Offset = new Point(0, 3),
            Radius = 6,
            Opacity = 0.3f
        };
        if (Microsoft.Maui.Controls.Application.Current?.Resources.TryGetValue("Primary", out var primary) == true
            && primary is Color primaryColor)
        {
            BackgroundColor = primaryColor;
        }
        Content = new Label
        {
            Text = Fonts.FluentUI.full_screen_minimize_24_regular,
            FontFamily = "FluentIcons",
            FontSize = 24,
            TextColor = Colors.White,
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.Center,
            HorizontalTextAlignment = TextAlignment.Center,
            VerticalTextAlignment = TextAlignment.Center
        };
        SetupGestureHandlers();
    }

    private void SetupGestureHandlers()
    {
#if ANDROID
        HandlerChanged += (_, _) =>
        {
            if (Handler?.PlatformView is Android.Views.View nativeView)
            {
                _touchSlop = (nativeView.Context is { } ctx
                    ? Android.Views.ViewConfiguration.Get(ctx)?.ScaledTouchSlop
                    : null) ?? 24;
                _density = (float)DeviceDisplay.MainDisplayInfo.Density;
                nativeView.Touch += OnNativeTouch;
            }
        };
#else
        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) => ExitRequested?.Invoke(this, EventArgs.Empty);
        GestureRecognizers.Add(tap);

        var pan = new PanGestureRecognizer();
        pan.PanUpdated += OnPan;
        GestureRecognizers.Add(pan);
#endif
    }

    /// <summary>Moves the button back to its docked corner on fullscreen entry.</summary>
    public void ResetPosition()
    {
        TranslationX = 0;
        TranslationY = 0;
    }

#if ANDROID
    private float _touchStartRawX;
    private float _touchStartRawY;
    private double _dragStartTx;
    private double _dragStartTy;
    private bool _isDragging;
    private int _touchSlop;
    private float _density;

    /// <summary>
    /// Native Android touch handler: uses getRawX/getRawY (screen coordinates)
    /// which are never affected by view translation, RTL layout, or MAUI
    /// coordinate transforms.
    /// </summary>
    private void OnNativeTouch(object? sender, Android.Views.View.TouchEventArgs e)
    {
        if (e.Event is not { } motion)
        {
            return;
        }

        switch (motion.ActionMasked)
        {
            case Android.Views.MotionEventActions.Down:
                _touchStartRawX = motion.RawX;
                _touchStartRawY = motion.RawY;
                _dragStartTx = TranslationX;
                _dragStartTy = TranslationY;
                _isDragging = false;
                e.Handled = true;
                break;

            case Android.Views.MotionEventActions.Move:
                {
                    var dx = motion.RawX - _touchStartRawX;
                    var dy = motion.RawY - _touchStartRawY;

                    if (!_isDragging &&
                        (Math.Abs(dx) > _touchSlop || Math.Abs(dy) > _touchSlop))
                    {
                        _isDragging = true;
                    }

                    if (_isDragging)
                    {
                        TranslationX = _dragStartTx + dx / _density;
                        TranslationY = _dragStartTy + dy / _density;
                    }
                    e.Handled = true;
                    break;
                }

            case Android.Views.MotionEventActions.Up:
                if (!_isDragging)
                {
                    ExitRequested?.Invoke(this, EventArgs.Empty);
                }
                e.Handled = true;
                break;

            case Android.Views.MotionEventActions.Cancel:
                e.Handled = true;
                break;

            default:
                // Other motion actions do not affect the exit-button drag.
                break;
        }
    }
#else
    private double _panStartX;
    private double _panStartY;

    private void OnPan(object? sender, PanUpdatedEventArgs e)
    {
        switch (e.StatusType)
        {
            case GestureStatus.Started:
                _panStartX = TranslationX;
                _panStartY = TranslationY;
                break;
            case GestureStatus.Running:
                TranslationX = _panStartX + e.TotalX;
                TranslationY = _panStartY + e.TotalY;
                break;

            default:
                // Completed/canceled gestures keep the button where the pan left it.
                break;
        }
    }
#endif
}
