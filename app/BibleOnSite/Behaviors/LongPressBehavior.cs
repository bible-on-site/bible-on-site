using System.Timers;
using System.Windows.Input;

namespace BibleOnSite.Behaviors;

/// <summary>
/// A cross-platform long-press behavior that uses a timer-based approach.
/// More reliable than TouchBehavior for preventing rapid-tap false positives.
/// </summary>
public class LongPressBehavior : Behavior<View>
{
    private View? _associatedView;
    private System.Timers.Timer? _longPressTimer;
    private bool _isPressed;
    private static DateTime _lastLongPressTime = DateTime.MinValue;

    public static readonly BindableProperty LongPressDurationProperty =
        BindableProperty.Create(nameof(LongPressDuration), typeof(int), typeof(LongPressBehavior), 600);

    public static readonly BindableProperty CommandProperty =
        BindableProperty.Create(nameof(Command), typeof(ICommand), typeof(LongPressBehavior));

    public static readonly BindableProperty CommandParameterProperty =
        BindableProperty.Create(nameof(CommandParameter), typeof(object), typeof(LongPressBehavior));

    public int LongPressDuration
    {
        get => (int)GetValue(LongPressDurationProperty);
        set => SetValue(LongPressDurationProperty, value);
    }

    public ICommand? Command
    {
        get => (ICommand?)GetValue(CommandProperty);
        set => SetValue(CommandProperty, value);
    }

    public object? CommandParameter
    {
        get => GetValue(CommandParameterProperty);
        set => SetValue(CommandParameterProperty, value);
    }

    public event EventHandler<EventArgs>? LongPressed;

    /// <summary>
    /// Gets the view this behavior is attached to.
    /// </summary>
    public View? AssociatedView => _associatedView;

    protected override void OnAttachedTo(View bindable)
    {
        base.OnAttachedTo(bindable);
        _associatedView = bindable;

        // Use Handler to attach native touch events
        bindable.HandlerChanged += OnHandlerChanged;
    }

    protected override void OnDetachingFrom(View bindable)
    {
        bindable.HandlerChanged -= OnHandlerChanged;
        CleanupTimer();
        DetachNativeEvents();
        _associatedView = null;
        base.OnDetachingFrom(bindable);
    }

    private void OnHandlerChanged(object? sender, EventArgs e)
    {
        if (_associatedView?.Handler != null)
        {
            AttachNativeEvents();
        }
    }

    private void AttachNativeEvents()
    {
#if ANDROID
        if (_associatedView?.Handler?.PlatformView is Android.Views.View androidView)
        {
            androidView.Touch += OnAndroidTouch;
        }
#endif
    }

    private void DetachNativeEvents()
    {
#if ANDROID
        if (_associatedView?.Handler?.PlatformView is Android.Views.View androidView)
        {
            androidView.Touch -= OnAndroidTouch;
        }
#endif
    }

#if ANDROID
    private float _startX, _startY;
    private const float MoveThreshold = 30f; // Pixels - cancel if moved more than this

    private void OnAndroidTouch(object? sender, Android.Views.View.TouchEventArgs e)
    {
        switch (e.Event?.Action)
        {
            case Android.Views.MotionEventActions.Down:
                _startX = e.Event.GetX();
                _startY = e.Event.GetY();
                StartLongPressTimer();
                e.Handled = false; // Allow other gestures to process
                break;

            case Android.Views.MotionEventActions.Up:
            case Android.Views.MotionEventActions.Cancel:
                CancelLongPressTimer();
                e.Handled = false;
                break;

            case Android.Views.MotionEventActions.Move:
                // Cancel if finger moved too much (scrolling)
                if (_isPressed && e.Event != null)
                {
                    var dx = Math.Abs(e.Event.GetX() - _startX);
                    var dy = Math.Abs(e.Event.GetY() - _startY);
                    if (dx > MoveThreshold || dy > MoveThreshold)
                    {
                        CancelLongPressTimer();
                    }
                }
                e.Handled = false;
                break;

            default:
                e.Handled = false;
                break;
        }
    }
#endif

    private void StartLongPressTimer()
    {
        // Debounce: don't start if we just fired a long press (reduced to 300ms for responsiveness)
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
            return;

        _isPressed = true;
        CleanupTimer();

        _longPressTimer = new System.Timers.Timer(LongPressDuration);
        _longPressTimer.Elapsed += OnLongPressTimerElapsed;
        _longPressTimer.AutoReset = false;
        _longPressTimer.Start();
    }

    private void CancelLongPressTimer()
    {
        _isPressed = false;
        CleanupTimer();
    }

    private void OnLongPressTimerElapsed(object? sender, ElapsedEventArgs e)
    {
        if (!_isPressed)
            return;

        _lastLongPressTime = DateTime.Now;

        MainThread.BeginInvokeOnMainThread(() =>
        {
            LongPressed?.Invoke(this, EventArgs.Empty);

            var param = CommandParameter ?? _associatedView?.BindingContext;
            if (Command?.CanExecute(param) == true)
            {
                Command.Execute(param);
            }
        });
    }

    private void CleanupTimer()
    {
        if (_longPressTimer != null)
        {
            _longPressTimer.Stop();
            _longPressTimer.Elapsed -= OnLongPressTimerElapsed;
            _longPressTimer.Dispose();
            _longPressTimer = null;
        }
    }
}
