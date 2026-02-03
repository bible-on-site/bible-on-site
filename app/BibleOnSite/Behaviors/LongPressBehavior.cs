using System.Timers;
using System.Windows.Input;

namespace BibleOnSite.Behaviors;

/// <summary>
/// A cross-platform long-press behavior using timer-based detection.
/// Checks scroll state to prevent triggering during scroll.
/// </summary>
public class LongPressBehavior : Behavior<View>
{
    private View? _associatedView;
    private System.Timers.Timer? _longPressTimer;
    private bool _isPressed;

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
                // Only start timer if not currently scrolling
                if (!Pages.PerekPage.IsScrolling)
                {
                    StartLongPressTimer();
                }
                break;

            case Android.Views.MotionEventActions.Up:
            case Android.Views.MotionEventActions.Cancel:
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
        e.Handled = false; // Allow other gestures
    }
#else
    private void AttachNativeEvents() { }
    private void DetachNativeEvents() { }
#endif

    private void StartLongPressTimer()
    {
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

        // Double-check scroll state before firing
        if (Pages.PerekPage.IsScrolling)
            return;

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
