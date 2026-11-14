using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// על הפרק settings: which perek opens on startup.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class PerekPreferencesViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly PreferencesService _preferencesService;
    private readonly IPushNotificationService? _push;
    private readonly IAppNavigator? _navigator;
    private bool _pushChangeInFlight;

    // Lazily resolved so unit tests never reach the app singletons — the
    // parameterless production path resolves Instance on first push use.
    private IPushNotificationService Push => _push ?? PushNotificationService.Instance;
    private IAppNavigator Navigator => _navigator ?? ShellAppNavigator.Instance;

    public PerekPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public PerekPreferencesViewModel(PreferencesService preferencesService)
        : this(preferencesService, null, null)
    {
    }

    internal PerekPreferencesViewModel(PreferencesService preferencesService,
        IPushNotificationService? push, IAppNavigator? navigator)
    {
        _preferencesService = preferencesService;
        _push = push;
        _navigator = navigator;
        BibleOnSite.Helpers.WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.OnPreferencesChanged(null, EventArgs.Empty));
    }

    /// <summary>
    /// Which perek to load on startup.
    /// </summary>
    public PerekToLoad PerekToLoad
    {
        get => _preferencesService.PerekToLoad;
        set
        {
            if (_preferencesService.PerekToLoad == value)
            {
                return;
            }
            _preferencesService.PerekToLoad = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsPerekToLoadTodays));
            OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        }
    }

    /// <summary>True when startup perek is Today's.</summary>
    public bool IsPerekToLoadTodays
    {
        get => PerekToLoad == PerekToLoad.Todays;
        set
        {
            if (value)
            {
                PerekToLoad = PerekToLoad.Todays;
            }
        }
    }

    /// <summary>True when startup perek is Last learnt.</summary>
    public bool IsPerekToLoadLastLearnt
    {
        get => PerekToLoad == PerekToLoad.LastLearnt;
        set
        {
            if (value)
            {
                PerekToLoad = PerekToLoad.LastLearnt;
            }
        }
    }

    /// <summary>Selects הפרק של היום as the startup perek.</summary>
    [RelayCommand]
    private void SelectTodaysPerek()
    {
        PerekToLoad = PerekToLoad.Todays;
    }

    /// <summary>Selects האחרון שלמדתי as the startup perek.</summary>
    [RelayCommand]
    private void SelectLastLearntPerek()
    {
        PerekToLoad = PerekToLoad.LastLearnt;
    }

    /// <summary>
    /// Whether the מסורה על הפרק flyout menu entry is shown (opt-in, #2181).
    /// </summary>
    public bool MasoraMenuEnabled
    {
        get => _preferencesService.MasoraMenuEnabled;
        set
        {
            if (_preferencesService.MasoraMenuEnabled == value)
            {
                return;
            }

            _preferencesService.MasoraMenuEnabled = value;
            OnPropertyChanged();
        }
    }

    /// <summary>
    /// Global קריינות switch (default on, #2472). Off suppresses tap and
    /// automatic recitation and hides the headphones actions in the reader.
    /// </summary>
    public bool QriynotEnabled
    {
        get => _preferencesService.QriynotEnabled;
        set
        {
            if (_preferencesService.QriynotEnabled == value)
            {
                return;
            }

            _preferencesService.QriynotEnabled = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Maximum commentary sources shown across a whole chapter.</summary>
    public double InlineCommentaryLimit
    {
        get => _preferencesService.InlineCommentaryLimit;
        set
        {
            _preferencesService.InlineCommentaryLimit = double.IsFinite(value) ? (int)Math.Clamp(Math.Round(value), 1, 100) : 5;
            OnPropertyChanged();
        }
    }

    /// <summary>Whether this build/platform can receive push notifications (#1097).</summary>
    public bool NotificationsSupported => Push.IsSupported;

    /// <summary>
    /// Daily-perek push opt-in. The setter kicks the async platform flow —
    /// permission request, topic subscription — and the property re-reads the
    /// preference once it settles, so a denied or failed attempt snaps the
    /// toggle back to the stored value.
    /// </summary>
    public bool DailyPerekPushEnabled
    {
        get => _preferencesService.DailyPerekPushEnabled;
        set
        {
            if (_preferencesService.DailyPerekPushEnabled == value || _pushChangeInFlight)
            {
                return;
            }
            _ = SetDailyPerekPushAsync(value);
        }
    }

    /// <summary>The async opt-in/out flow behind <see cref="DailyPerekPushEnabled"/>.
    /// Internal so tests await the settled result instead of racing the switch.</summary>
    internal async Task SetDailyPerekPushAsync(bool enabled)
    {
        _pushChangeInFlight = true;
        try
        {
            var result = await Push.SetEnabledAsync(enabled, CancellationToken.None);
            OnPropertyChanged(nameof(DailyPerekPushEnabled));
            if (enabled && result == PushEnableResult.PermissionDenied)
            {
                var open = await Navigator.DisplayChoiceAsync(
                    "התראות חסומות",
                    "כדי לקבל התראה על הפרק היומי צריך לאפשר התראות בהגדרות המכשיר",
                    "פתח הגדרות",
                    "ביטול");
                if (open)
                {
                    OpenSystemNotificationSettings();
                }
            }
            else if (enabled && result == PushEnableResult.Failed)
            {
                await Navigator.DisplayAlertAsync(
                    "שגיאה", "הפעלת ההתראות נכשלה. נסו שוב מאוחר יותר", "סגור");
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a push flow error re-syncs the toggle instead of faulting the fire-and-forget task
        catch (Exception ex) //NOSONAR — a push flow error re-syncs the toggle instead of faulting the fire-and-forget task.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Push toggle failed: {ex.Message}");
            OnPropertyChanged(nameof(DailyPerekPushEnabled));
        }
        finally
        {
            _pushChangeInFlight = false;
        }
    }

    private static void OpenSystemNotificationSettings()
    {
#if ANDROID || IOS
        AppInfo.ShowSettingsUI();
#endif
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        OnPropertyChanged(nameof(MasoraMenuEnabled));
        OnPropertyChanged(nameof(QriynotEnabled));
        OnPropertyChanged(nameof(InlineCommentaryLimit));
        OnPropertyChanged(nameof(DailyPerekPushEnabled));
    }
}
