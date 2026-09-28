using System.Timers;
using System.Windows.Input;
using BibleOnSite.Helpers;

namespace BibleOnSite.Behaviors;

/// <summary>
/// A cross-platform long-press behavior using timer-based detection.
/// On Android it also detects taps natively, because MAUI's TapGestureRecognizer
/// fails to propagate taps through nested CarouselView > CollectionView templates.
/// Cancels on movement and validates delayed callbacks before selecting a verse.
/// </summary>
public class LongPressBehavior : Behavior<View>
{
    private View? _associatedView;
    private System.Timers.Timer? _longPressTimer;
    private ElapsedEventHandler? _timerElapsed;
    private readonly PressGestureTracker _press = new();

    // Static list of all active behaviors for global cancellation
    private static readonly List<LongPressBehavior> _activeBehaviors = new();
    private static readonly object _lock = new();

    /// <summary>
    /// Cancels all pending long-press timers. Called when scroll starts.
    /// </summary>
    public static void CancelAllPending()
    {
        lock (_lock)
        {
            foreach (var behavior in _activeBehaviors)
            {
                behavior.CancelLongPressTimer();
            }
        }
    }

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
    /// Raised on Android when a short tap (Down → Up without long-press) is detected
    /// via native touch events. Use instead of TapGestureRecognizer inside nested
    /// CarouselView/CollectionView templates where MAUI gestures silently fail.
    /// Kept public on all platforms for XAML binding compatibility; only raised on Android.
    /// </summary>
#pragma warning disable CS0067 // Event is never used (raised only on Android via native touch)
    public event EventHandler<EventArgs>? NativeTapped;
#pragma warning restore CS0067

    /// <summary>
    /// Gets the view this behavior is attached to.
    /// </summary>
    public View? AssociatedView => _associatedView;

    /// <summary>
    /// Call this when a tap is detected to cancel any pending long-press.
    /// Used because Android CollectionView swallows Up events.
    /// </summary>
    public void OnTapDetected()
    {
        System.Diagnostics.Debug.WriteLine("[LongPress] Tap detected, cancelling timer");
        CancelLongPressTimer();
    }

    protected override void OnAttachedTo(View bindable)
    {
        base.OnAttachedTo(bindable);
        _associatedView = bindable;
        bindable.HandlerChanged += OnHandlerChanged;
        bindable.BindingContextChanged += OnBindingContextChanged;
        AttachNativeEvents();

        lock (_lock)
        {
            _activeBehaviors.Add(this);
        }
    }

    protected override void OnDetachingFrom(View bindable)
    {
        lock (_lock)
        {
            _activeBehaviors.Remove(this);
        }

        bindable.HandlerChanged -= OnHandlerChanged;
        bindable.BindingContextChanged -= OnBindingContextChanged;
        CancelLongPressTimer();
        DetachNativeEvents();
        _associatedView = null;
        base.OnDetachingFrom(bindable);
    }

    private void OnBindingContextChanged(object? sender, EventArgs e) => CancelLongPressTimer();

    private void OnHandlerChanged(object? sender, EventArgs e)
    {
        CancelLongPressTimer();
        DetachNativeEvents();
        AttachNativeEvents();
    }

#if ANDROID
    private Android.Views.View? _androidView;

    private void AttachNativeEvents()
    {
        if (_associatedView?.Handler?.PlatformView is Android.Views.View androidView)
        {
            _androidView = androidView;
            androidView.Touch += OnAndroidTouch;
        }
    }

    private void DetachNativeEvents()
    {
        if (_androidView != null)
        {
            _androidView.Touch -= OnAndroidTouch;
            _androidView = null;
        }
    }

    private void OnAndroidTouch(object? sender, Android.Views.View.TouchEventArgs e)
    {
        if (e.Event is not { } motion)
            return;

        switch (motion.ActionMasked)
        {
            case Android.Views.MotionEventActions.Down:
                var touchSlop = _androidView?.Context is { } context
                    ? Android.Views.ViewConfiguration.Get(context)?.ScaledTouchSlop ?? 12
                    : 12;
                _press.Begin(motion.RawX, motion.RawY, touchSlop);
                // A new stationary press is independent of the previous scroll.
                // Motion beyond touch slop cancels it in MainActivity.
                StartLongPressTimer();

                // Claim Down to receive Up. RecyclerView retains responsibility
                // for intercepting horizontal swipes and vertical scrolls.
                e.Handled = true;
                return;

            case Android.Views.MotionEventActions.Up:
                // Also check the release coordinates if Android coalesced moves.
                _press.Move(motion.RawX, motion.RawY, isScrolling: false);
                var tapped = _press.End();
                CleanupTimer();
                if (tapped)
                    NativeTapped?.Invoke(this, EventArgs.Empty);
                break;

            case Android.Views.MotionEventActions.Cancel:
            case Android.Views.MotionEventActions.PointerDown:
            case Android.Views.MotionEventActions.PointerUp:
                CancelLongPressTimer();
                break;

            case Android.Views.MotionEventActions.Move:
                _press.Move(motion.RawX, motion.RawY, isScrolling: false);
                if (!_press.IsPressed)
                    CleanupTimer();
                break;
        }
        e.Handled = false;
    }
#else
    private void AttachNativeEvents() { }
    private void DetachNativeEvents() { }
#endif

    private void StartLongPressTimer()
    {
        CleanupTimer();

        _longPressTimer = new System.Timers.Timer(LongPressDuration);
        var pressId = _press.PressId;
        _timerElapsed = (_, _) => OnLongPressTimerElapsed(pressId);
        _longPressTimer.Elapsed += _timerElapsed;
        _longPressTimer.AutoReset = false;
        _longPressTimer.Start();
    }

    private void CancelLongPressTimer()
    {
        _press.Cancel();
        CleanupTimer();
    }

    private void OnLongPressTimerElapsed(int pressId)
    {
        _press.DispatchLongPress(pressId, MainThread.BeginInvokeOnMainThread, () =>
        {
            LongPressed?.Invoke(this, EventArgs.Empty);

            var param = CommandParameter ?? _associatedView?.BindingContext;
            if (Command?.CanExecute(param) == true)
            {
                Command.Execute(param);
            }
        }, () => false);
    }

    private void CleanupTimer()
    {
        if (_longPressTimer != null)
        {
            _longPressTimer.Stop();
            _longPressTimer.Elapsed -= _timerElapsed;
            _timerElapsed = null;
            _longPressTimer.Dispose();
            _longPressTimer = null;
        }
    }
}
