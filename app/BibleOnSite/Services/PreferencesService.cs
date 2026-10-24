using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// Enum representing which perek to load on app startup.
/// </summary>
public enum PerekToLoad
{
    Todays = 0,
    LastLearnt = 1
}

/// <summary>
/// Android-only override for the visible in-app Back/Up control (#2467).
/// PlatformDefault and Hide both rely on system Back on Android; Show
/// duplicates it in the app chrome. Other platforms ignore the value —
/// the Android choice must not leak into iOS/Windows behavior.
/// </summary>
public enum InAppBackButtonPreference
{
    PlatformDefault = 0,
    Show = 1,
    Hide = 2
}

/// <summary>
/// Service for managing user preferences.
/// Uses IPreferencesStorage abstraction for testability.
/// </summary>
public class PreferencesService
{
    private static PreferencesService? _instance;
    private static readonly object _lock = new();

    /// <summary>
    /// Gets the singleton instance. For MAUI apps, Initialize should be called first.
    /// For testing, use CreateForTesting instead.
    /// </summary>
    public static PreferencesService Instance
    {
        get
        {
            if (_instance == null)
            {
                throw new InvalidOperationException(
                    "PreferencesService not initialized. Call Initialize() first or use CreateForTesting().");
            }
            return _instance;
        }
    }

    /// <summary>
    /// Initializes the singleton with the provided storage implementation.
    /// Call this once at app startup.
    /// </summary>
    public static void Initialize(IPreferencesStorage storage)
    {
        lock (_lock)
        {
            _instance ??= new PreferencesService(storage);
        }
    }

    /// <summary>
    /// Creates a new instance for testing purposes. Does not affect the singleton.
    /// </summary>
    public static PreferencesService CreateForTesting(IPreferencesStorage storage)
    {
        return new PreferencesService(storage);
    }

    /// <summary>
    /// Resets the singleton instance. Only for testing.
    /// </summary>
    internal static void ResetForTesting()
    {
        lock (_lock)
        {
            _instance = null;
        }
    }

    private const string InlineCommentaryLimitKey = "inlineCommentaryLimit";
    private int _inlineCommentaryLimit = 5;

    public int InlineCommentaryLimit
    {
        get => _inlineCommentaryLimit;
        set
        {
            var normalized = Math.Clamp(value, 1, 100);
            if (_inlineCommentaryLimit == normalized) { return; }
            _inlineCommentaryLimit = normalized;
            _storage.Set(InlineCommentaryLimitKey, normalized);
            OnPreferencesChanged();
        }
    }

    private const string FontFactorKey = "fontFactor";
    private const string PasukFontPercentKey = "pasukFontPercent";
    private const string PerushFontPercentKey = "perushFontPercent";
    private const string ArticleFontPercentKey = "articleFontPercent";
    private const string LastLearntPerekKey = "lastLearntPerek";
    private const string PerekToLoadKey = "perekToLoad";
    private const string BookmarkedPerakimKey = "bookmarkedPerakim";
    private const string MasoraMenuEnabledKey = "masoraMenuEnabled";
    private const string InAppBackButtonKey = "inAppBackButton";

    // הסתר שם השם — stored values mirror the website's divineNameMasking
    // settings (same option spellings), so the policy stays portable.
    private const string DivineNameMaskingEnabledKey = "divineNameMaskingEnabled";
    private const string DivineNameMaskElohimKey = "divineNameMaskElohim";
    private const string DivineNameMaskElohimCustomKey = "divineNameMaskElohimCustom";
    private const string DivineNameMaskYhwhKey = "divineNameMaskYhwh";
    private const string DivineNameMaskYhwhCustomKey = "divineNameMaskYhwhCustom";
    private const string DivineNameMaskElKey = "divineNameMaskEl";
    private const string DivineNameMaskShaddaiKey = "divineNameMaskShaddai";
    private const string DivineNameMaskShaddaiCustomKey = "divineNameMaskShaddaiCustom";

    private const int MaxDivineNameCustomLength = 40;

    private static readonly IReadOnlyDictionary<string, DivineNameMaskOption> MaskOptionNames =
        new Dictionary<string, DivineNameMaskOption>(StringComparer.OrdinalIgnoreCase)
        {
            ["asis"] = DivineNameMaskOption.AsIs,
            ["elokim"] = DivineNameMaskOption.Elokim,
            ["hyphen"] = DivineNameMaskOption.Hyphen,
            ["heh"] = DivineNameMaskOption.Heh,
            ["dalet"] = DivineNameMaskOption.Dalet,
            ["custom"] = DivineNameMaskOption.Custom,
        };

    private static string MaskOptionName(DivineNameMaskOption option) => option switch
    {
        DivineNameMaskOption.AsIs => "asis",
        DivineNameMaskOption.Elokim => "elokim",
        DivineNameMaskOption.Hyphen => "hyphen",
        DivineNameMaskOption.Heh => "heh",
        DivineNameMaskOption.Dalet => "dalet",
        _ => "custom",
    };

    /// <summary>The options each name allows; out-of-set values fall back to the default.</summary>
    private static readonly DivineNameMaskOption[] ElohimOptions =
        [DivineNameMaskOption.AsIs, DivineNameMaskOption.Elokim, DivineNameMaskOption.Hyphen, DivineNameMaskOption.Custom];
    private static readonly DivineNameMaskOption[] YhwhOptions =
        [DivineNameMaskOption.Heh, DivineNameMaskOption.Dalet, DivineNameMaskOption.Custom];
    private static readonly DivineNameMaskOption[] ElOptions =
        [DivineNameMaskOption.AsIs, DivineNameMaskOption.Hyphen];
    private static readonly DivineNameMaskOption[] ShaddaiOptions =
        [DivineNameMaskOption.AsIs, DivineNameMaskOption.Hyphen, DivineNameMaskOption.Custom];


    private const string QriynotEnabledKey = "qriynotEnabled";
    private bool _qriynotEnabled = true;

    /// <summary>
    /// Global קריינות switch (העדפות → על הפרק). Default on for new and upgraded
    /// installations — an unset preference resolves to enabled, while a stored
    /// explicit choice (including off) is honored (#2472).
    /// </summary>
    public bool QriynotEnabled
    {
        get => _qriynotEnabled;
        set
        {
            if (_qriynotEnabled == value)
            {
                return;
            }

            _qriynotEnabled = value;
            _storage.Set(QriynotEnabledKey, value);
            OnPreferencesChanged();
        }
    }

    private double _recitationSpeed = 1;
    private double _recitationVolume = 1;
    private double _lessonsVolume = 1;
    private double _effectsVolume = 1;
    private double _recitationVersePauseMs = -1;
    // A negative pause preserves the original recording; custom pauses are wall-clock milliseconds.
    public double RecitationSpeed
    {
        get => _recitationSpeed;
        set => SetAudioValue(ref _recitationSpeed, "recitationSpeed", Normalize(value, 1, 0.5, 2));
    }
    public double RecitationVolume
    {
        get => _recitationVolume;
        set => SetAudioValue(ref _recitationVolume, "recitationVolume", Normalize(value, 1, 0, 1));
    }
    /// <summary>Recorded-lesson playback volume (article audio/video), independent of קריינות.</summary>
    public double LessonsVolume
    {
        get => _lessonsVolume;
        set => SetAudioValue(ref _lessonsVolume, "lessonsVolume", Normalize(value, 1, 0, 1));
    }
    /// <summary>Sound-effects volume, independent of speech playback.</summary>
    public double EffectsVolume
    {
        get => _effectsVolume;
        set => SetAudioValue(ref _effectsVolume, "effectsVolume", Normalize(value, 1, 0, 1));
    }
    public double RecitationVersePauseMs
    {
        get => _recitationVersePauseMs;
        set => SetAudioValue(ref _recitationVersePauseMs, "recitationVersePauseMs", Normalize(value, -1, -1, 5000));
    }
    private static double Normalize(double value, double fallback, double min, double max) =>
        double.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;
    private void SetAudioValue(ref double field, string key, double value)
    {
        if (Math.Abs(field - value) < 0.000001) { return; }
        field = value;
        _storage.Set(key, value);
        OnPreferencesChanged();
    }

    #region הסתר שם השם

    // #2404: masking ships enabled with אל → א-ל; explicit stored false/asis
    // choices are still honored on Load.
    private bool _divineNameMaskingEnabled = true;
    private DivineNameMaskOption _divineNameMaskElohim = DivineNameMaskOption.Hyphen;
    private string _divineNameMaskElohimCustom = "";
    private DivineNameMaskOption _divineNameMaskYhwh = DivineNameMaskOption.Heh;
    private string _divineNameMaskYhwhCustom = "";
    private DivineNameMaskOption _divineNameMaskEl = DivineNameMaskOption.Hyphen;
    private DivineNameMaskOption _divineNameMaskShaddai = DivineNameMaskOption.AsIs;
    private string _divineNameMaskShaddaiCustom = "";

    /// <summary>
    /// הסתר שם השם master toggle — independent of the per-name choices, which
    /// keep their stored values while masking is off.
    /// </summary>
    public bool DivineNameMaskingEnabled
    {
        get => _divineNameMaskingEnabled;
        set
        {
            if (_divineNameMaskingEnabled == value)
            {
                return;
            }
            _divineNameMaskingEnabled = value;
            _storage.Set(DivineNameMaskingEnabledKey, value);
            OnMaskingChanged();
        }
    }

    /// <summary>אלהים display option (asis/elokim/hyphen/custom).</summary>
    public DivineNameMaskOption DivineNameMaskElohim
    {
        get => _divineNameMaskElohim;
        set => SetMaskOption(ref _divineNameMaskElohim, value, ElohimOptions,
            DivineNameMaskOption.Hyphen, DivineNameMaskElohimKey);
    }

    /// <summary>Custom replacement text for אלהים when "אחר" is chosen.</summary>
    public string DivineNameMaskElohimCustom
    {
        get => _divineNameMaskElohimCustom;
        set => SetMaskCustom(ref _divineNameMaskElohimCustom, value, DivineNameMaskElohimCustomKey);
    }

    /// <summary>יהוה display option (heh/dalet/custom — no as-is).</summary>
    public DivineNameMaskOption DivineNameMaskYhwh
    {
        get => _divineNameMaskYhwh;
        set => SetMaskOption(ref _divineNameMaskYhwh, value, YhwhOptions,
            DivineNameMaskOption.Heh, DivineNameMaskYhwhKey);
    }

    /// <summary>Custom replacement text for יהוה when "אחר" is chosen.</summary>
    public string DivineNameMaskYhwhCustom
    {
        get => _divineNameMaskYhwhCustom;
        set => SetMaskCustom(ref _divineNameMaskYhwhCustom, value, DivineNameMaskYhwhCustomKey);
    }

    /// <summary>אל display option (asis/hyphen — no custom).</summary>
    public DivineNameMaskOption DivineNameMaskEl
    {
        get => _divineNameMaskEl;
        set => SetMaskOption(ref _divineNameMaskEl, value, ElOptions,
            DivineNameMaskOption.Hyphen, DivineNameMaskElKey);
    }

    /// <summary>שדי display option (asis/hyphen/custom).</summary>
    public DivineNameMaskOption DivineNameMaskShaddai
    {
        get => _divineNameMaskShaddai;
        set => SetMaskOption(ref _divineNameMaskShaddai, value, ShaddaiOptions,
            DivineNameMaskOption.AsIs, DivineNameMaskShaddaiKey);
    }

    /// <summary>Custom replacement text for שדי when "אחר" is chosen.</summary>
    public string DivineNameMaskShaddaiCustom
    {
        get => _divineNameMaskShaddaiCustom;
        set => SetMaskCustom(ref _divineNameMaskShaddaiCustom, value, DivineNameMaskShaddaiCustomKey);
    }

    private void SetMaskOption(ref DivineNameMaskOption field, DivineNameMaskOption value,
        DivineNameMaskOption[] allowed, DivineNameMaskOption fallback, string key)
    {
        if (!allowed.Contains(value))
        {
            value = fallback;
        }
        if (field == value)
        {
            return;
        }
        field = value;
        _storage.Set(key, MaskOptionName(value));
        OnMaskingChanged();
    }

    private void SetMaskCustom(ref string field, string value, string key)
    {
        var trimmed = (value ?? "").Trim();
        if (trimmed.Length > MaxDivineNameCustomLength)
        {
            trimmed = trimmed[..MaxDivineNameCustomLength];
        }
        if (field == trimmed)
        {
            return;
        }
        field = trimmed;
        _storage.Set(key, trimmed);
        OnMaskingChanged();
    }

    private static DivineNameMaskOption ParseMaskOption(string stored, DivineNameMaskOption[] allowed,
        DivineNameMaskOption fallback) =>
        MaskOptionNames.TryGetValue(stored, out var option) && allowed.Contains(option)
            ? option
            : fallback;

    /// <summary>Builds the immutable options snapshot consumed by renderers.</summary>
    public DivineNameMaskingOptions GetDivineNameMaskingOptions() => new(
        _divineNameMaskingEnabled,
        _divineNameMaskElohim, _divineNameMaskElohimCustom,
        _divineNameMaskYhwh, _divineNameMaskYhwhCustom,
        _divineNameMaskEl,
        _divineNameMaskShaddai, _divineNameMaskShaddaiCustom);

    /// <summary>
    /// Publishes the current options to <see cref="DivineNameMasking"/> (bumping
    /// its revision so cached renderings rebuild) and notifies preference
    /// listeners so open pages refresh their displayed text.
    /// </summary>
    private void OnMaskingChanged()
    {
        DivineNameMasking.Apply(GetDivineNameMaskingOptions());
        OnPreferencesChanged();
    }

    #endregion

    private InAppBackButtonPreference _inAppBackButton = InAppBackButtonPreference.PlatformDefault;

    /// <summary>
    /// Visible in-app Back/Up chrome preference (#2467). Persisted tri-state;
    /// applied only by the Android chrome policy — iOS/Windows always follow
    /// their platform default. Unset/stale values resolve to PlatformDefault.
    /// </summary>
    public InAppBackButtonPreference InAppBackButton
    {
        get => _inAppBackButton;
        set
        {
            if (!Enum.IsDefined(value))
            {
                value = InAppBackButtonPreference.PlatformDefault;
            }
            if (_inAppBackButton == value)
            {
                return;
            }

            _inAppBackButton = value;
            _storage.Set(InAppBackButtonKey, (int)value);
            OnPreferencesChanged();
        }
    }

    private bool _masoraMenuEnabled;

    /// <summary>
    /// Whether the מסורה על הפרק flyout menu entry is shown. Opt-in only:
    /// unset resolves to false for fresh installs and upgrades (#2181).
    /// </summary>
    public bool MasoraMenuEnabled
    {
        get => _masoraMenuEnabled;
        set
        {
            if (_masoraMenuEnabled == value)
            {
                return;
            }

            _masoraMenuEnabled = value;
            _storage.Set(MasoraMenuEnabledKey, value);
            OnPreferencesChanged();
        }
    }

    private readonly IPreferencesStorage _storage;
    private double _fontFactor = 1.0;
    private double _pasukFontPercent = DefaultFontPercent;
    private double _perushFontPercent = DefaultFontPercent;
    private double _articleFontPercent = DefaultFontPercent;
    private int? _lastLearntPerek;
    private PerekToLoad _perekToLoad = PerekToLoad.Todays;
    private HashSet<int> _bookmarkedPerakim = new();

    public event EventHandler? PreferencesChanged;

    private PreferencesService(IPreferencesStorage storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    /// <summary>
    /// Master font size multiplier for text display.
    /// </summary>
    public double FontFactor
    {
        get => _fontFactor;
        set
        {
            if (Math.Abs(_fontFactor - value) < 0.001)
            {
                return;
            }

            _fontFactor = value;
            _storage.Set(FontFactorKey, value);
            OnPreferencesChanged();
        }
    }

    #region Font category percentages (#2461)

    // Per-reading-category size relative to the master FontFactor:
    // effective factor = FontFactor × percent / 100. 100% means "follow the
    // master"; there is deliberately no perush→pasuk coupling.
    public static double MinFontPercent => 50;
    public static double MaxFontPercent => 200;
    public static double DefaultFontPercent => 100;

    /// <summary>פסוקים body size relative to the master (covers pasuk text
    /// and pasuk-number markers in every reader, including שניים מקרא and
    /// תיקון קוראים).</summary>
    public double PasukFontPercent
    {
        get => _pasukFontPercent;
        set => SetFontPercent(ref _pasukFontPercent, value, PasukFontPercentKey);
    }

    /// <summary>פירושים size relative to the master (perush name and content
    /// in inline and focused-pasuk commentary).</summary>
    public double PerushFontPercent
    {
        get => _perushFontPercent;
        set => SetFontPercent(ref _perushFontPercent, value, PerushFontPercentKey);
    }

    /// <summary>מאמרים body size relative to the master (article detail and
    /// תנ"ךפדיה entry/entity-type pages).</summary>
    public double ArticleFontPercent
    {
        get => _articleFontPercent;
        set => SetFontPercent(ref _articleFontPercent, value, ArticleFontPercentKey);
    }

    /// <summary>Effective pasuk scaling factor: master × pasuk percent.</summary>
    public double PasukFontFactor => FontFactor * PasukFontPercent / 100.0;

    /// <summary>Effective perush scaling factor: master × perush percent.</summary>
    public double PerushFontFactor => FontFactor * PerushFontPercent / 100.0;

    /// <summary>Effective article scaling factor: master × article percent.</summary>
    public double ArticleFontFactor => FontFactor * ArticleFontPercent / 100.0;

    private void SetFontPercent(ref double field, double value, string key)
    {
        var normalized = Normalize(value, DefaultFontPercent, MinFontPercent, MaxFontPercent);
        if (Math.Abs(field - normalized) < 0.000001)
        {
            return;
        }
        field = normalized;
        _storage.Set(key, normalized);
        OnPreferencesChanged();
    }

    #endregion

    /// <summary>
    /// The last perek the user was learning (perek ID).
    /// </summary>
    public int? LastLearntPerek
    {
        get => _lastLearntPerek;
        set
        {
            if (_lastLearntPerek == value)
            {
                return;
            }

            _lastLearntPerek = value;
            if (value.HasValue)
            {
                _storage.Set(LastLearntPerekKey, value.Value);
            }
            else
            {
                _storage.Remove(LastLearntPerekKey);
            }
            OnPreferencesChanged();
        }
    }

    /// <summary>
    /// Which perek to load on startup.
    /// </summary>
    public PerekToLoad PerekToLoad
    {
        get => _perekToLoad;
        set
        {
            if (_perekToLoad == value)
            {
                return;
            }

            _perekToLoad = value;
            _storage.Set(PerekToLoadKey, (int)value);
            OnPreferencesChanged();
        }
    }

    /// <summary>
    /// Set of bookmarked perek IDs.
    /// </summary>
    public IReadOnlySet<int> BookmarkedPerakim => _bookmarkedPerakim;

    /// <summary>
    /// Loads preferences from storage.
    /// </summary>
    public void Load()
    {
        _masoraMenuEnabled = _storage.Get(MasoraMenuEnabledKey, false);
        _qriynotEnabled = _storage.Get(QriynotEnabledKey, true);
        var storedBackButton = _storage.Get(InAppBackButtonKey, (int)InAppBackButtonPreference.PlatformDefault);
        _inAppBackButton = Enum.IsDefined((InAppBackButtonPreference)storedBackButton)
            ? (InAppBackButtonPreference)storedBackButton
            : InAppBackButtonPreference.PlatformDefault;
        _recitationSpeed = Normalize(_storage.Get("recitationSpeed", 1.0), 1, 0.5, 2);
        _recitationVolume = Normalize(_storage.Get("recitationVolume", 1.0), 1, 0, 1);
        _lessonsVolume = Normalize(_storage.Get("lessonsVolume", 1.0), 1, 0, 1);
        _effectsVolume = Normalize(_storage.Get("effectsVolume", 1.0), 1, 0, 1);
        _recitationVersePauseMs = Normalize(_storage.Get("recitationVersePauseMs", -1.0), -1, -1, 5000);
        _inlineCommentaryLimit = Math.Clamp(_storage.Get(InlineCommentaryLimitKey, 5), 1, 100);
        _fontFactor = _storage.Get(FontFactorKey, 1.0);
        _pasukFontPercent = Normalize(_storage.Get(PasukFontPercentKey, DefaultFontPercent),
            DefaultFontPercent, MinFontPercent, MaxFontPercent);
        _perushFontPercent = Normalize(_storage.Get(PerushFontPercentKey, DefaultFontPercent),
            DefaultFontPercent, MinFontPercent, MaxFontPercent);
        _articleFontPercent = Normalize(_storage.Get(ArticleFontPercentKey, DefaultFontPercent),
            DefaultFontPercent, MinFontPercent, MaxFontPercent);

        var lastLearnt = _storage.Get(LastLearntPerekKey, -1);
        _lastLearntPerek = lastLearnt >= 0 ? lastLearnt : null;

        _perekToLoad = (PerekToLoad)_storage.Get(PerekToLoadKey, (int)PerekToLoad.Todays);

        _divineNameMaskingEnabled = _storage.Get(DivineNameMaskingEnabledKey, true);
        _divineNameMaskElohim = ParseMaskOption(_storage.Get(DivineNameMaskElohimKey, "hyphen"),
            ElohimOptions, DivineNameMaskOption.Hyphen);
        _divineNameMaskElohimCustom = _storage.Get(DivineNameMaskElohimCustomKey, "");
        _divineNameMaskYhwh = ParseMaskOption(_storage.Get(DivineNameMaskYhwhKey, "heh"),
            YhwhOptions, DivineNameMaskOption.Heh);
        _divineNameMaskYhwhCustom = _storage.Get(DivineNameMaskYhwhCustomKey, "");
        _divineNameMaskEl = ParseMaskOption(_storage.Get(DivineNameMaskElKey, "hyphen"),
            ElOptions, DivineNameMaskOption.Hyphen);
        _divineNameMaskShaddai = ParseMaskOption(_storage.Get(DivineNameMaskShaddaiKey, "asis"),
            ShaddaiOptions, DivineNameMaskOption.AsIs);
        _divineNameMaskShaddaiCustom = _storage.Get(DivineNameMaskShaddaiCustomKey, "");
        var revisionBefore = DivineNameMasking.Revision;
        DivineNameMasking.Apply(GetDivineNameMaskingOptions());
        if (DivineNameMasking.Revision != revisionBefore)
        {
            // Stored masking differs from the ambient state — notify so any
            // already-open page re-renders its displayed text.
            OnPreferencesChanged();
        }

        var bookmarksJson = _storage.Get(BookmarkedPerakimKey, string.Empty);
        if (!string.IsNullOrEmpty(bookmarksJson))
        {
            try
            {
                var bookmarks = System.Text.Json.JsonSerializer.Deserialize(bookmarksJson, AppJsonContext.Default.BookmarkedPerakim);
                _bookmarkedPerakim = bookmarks != null ? new HashSet<int>(bookmarks) : new HashSet<int>();
            }
            catch (System.Text.Json.JsonException ex)
            {
                // A corrupt stored value cannot be partially salvaged — reset
                // to empty, but never silently: invisible data loss must leave
                // a diagnostic trace.
                Console.Error.WriteLine(
                    $"Stored perakim bookmarks reset — corrupt JSON ignored ({ex.Message})");
                _bookmarkedPerakim = new HashSet<int>();
            }
        }

        // Bulk-loaded state is a change for subscribers that bound earlier
        // (e.g. the Shell flyout content inflates before startup Load runs).
        OnPreferencesChanged();
    }

    /// <summary>
    /// Checks if a perek is bookmarked.
    /// </summary>
    public bool IsBookmarked(int perekId)
    {
        return _bookmarkedPerakim.Contains(perekId);
    }

    /// <summary>
    /// Toggles the bookmark status of a perek.
    /// </summary>
    public void ToggleBookmark(int perekId)
    {
        if (_bookmarkedPerakim.Contains(perekId))
        {
            _bookmarkedPerakim.Remove(perekId);
        }
        else
        {
            _bookmarkedPerakim.Add(perekId);
        }
        SaveBookmarks();
        OnPreferencesChanged();
    }

    /// <summary>
    /// Adds a bookmark for a perek.
    /// </summary>
    public void AddBookmark(int perekId)
    {
        if (_bookmarkedPerakim.Add(perekId))
        {
            SaveBookmarks();
            OnPreferencesChanged();
        }
    }

    /// <summary>
    /// Removes a bookmark for a perek.
    /// </summary>
    public void RemoveBookmark(int perekId)
    {
        if (_bookmarkedPerakim.Remove(perekId))
        {
            SaveBookmarks();
            OnPreferencesChanged();
        }
    }

    private void SaveBookmarks()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(_bookmarkedPerakim.ToArray(), AppJsonContext.Default.BookmarkedPerakim);
        _storage.Set(BookmarkedPerakimKey, json);
    }

    private void OnPreferencesChanged()
    {
        PreferencesChanged?.Invoke(this, EventArgs.Empty);
    }
}
