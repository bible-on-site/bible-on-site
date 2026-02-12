using System.Timers;
using System.Windows.Input;

namespace BibleOnSite.Behaviors;

/// <summary>
/// A cross-platform long-press behavior using timer-based detection.
/// On Android it also detects taps natively, because MAUI's TapGestureRecognizer
/// fails to propagate taps through nested CarouselView > CollectionView templates.
/// Checks scroll state to prevent triggering during scroll.
/// </summary>
public class LongPressBehavior : Behavior<View>
{
    private View? _associatedView;
    private System.Timers.Timer? _longPressTimer;
    private bool _isPressed;
    private bool _longPressFired;
    // Tracks whether a finger is actively down.  Unlike _isPressed (which
    // is cleared by CancelLongPressTimer during scroll), this is only
    // cleared on Up/Cancel so we can detect taps even after scroll-cancel.
    private bool _touchActive;

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
    /// </summary>
    public event EventHandler<EventArgs>? NativeTapped;

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

#if ANDROID
    private void AttachNativeEvents()
    {
        if (_associatedView?.Handler?.PlatformView is Android.Views.View androidView)
        {
            androidView.Touch += OnAndroidTouch;
        }
    }

    private void DetachNativeEvents()
    {
        if (_associatedView?.Handler?.PlatformView is Android.Views.View androidView)
        {
            androidView.Touch -= OnAndroidTouch;
        }
    }

    private void OnAndroidTouch(object? sender, Android.Views.View.TouchEventArgs e)
    {
        var action = e.Event?.Action & Android.Views.MotionEventActions.Mask;

        switch (action)
        {
            case Android.Views.MotionEventActions.Down:
                _touchActive = true;
                if (!Pages.PerekPage.IsScrolling)
                {
                    StartLongPressTimer();
                }
                // Claim the touch so we receive Up (needed for tap detection).
                // The RecyclerView can still intercept via onInterceptTouchEvent
                // when it detects a scroll gesture — it sends Cancel to us and
                // takes over.
                e.Handled = true;
                return;

            case Android.Views.MotionEventActions.Up:
                // If the finger lifted before the long-press timer fired,
                // this is a normal tap.  Use _touchActive (not _isPressed)
                // because _isPressed may be cleared by Move-scroll cancellation.
                if (_touchActive && !_longPressFired)
                {
                    NativeTapped?.Invoke(this, EventArgs.Empty);
                }
                _touchActive = false;
                CancelLongPressTimer();
                break;

            case Android.Views.MotionEventActions.Cancel:
                _touchActive = false;
                CancelLongPressTimer();
                break;

            case Android.Views.MotionEventActions.PointerUp:
                CancelLongPressTimer();
                break;

            case Android.Views.MotionEventActions.Move:
                // Cancel if scrolling started
                if (_isPressed && Pages.PerekPage.IsScrolling)
                {
                    CancelLongPressTimer();
                }
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
        _isPressed = true;
        _longPressFired = false;
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

        // Double-check scroll state before firing
        if (Pages.PerekPage.IsScrolling)
            return;

        _longPressFired = true;

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
