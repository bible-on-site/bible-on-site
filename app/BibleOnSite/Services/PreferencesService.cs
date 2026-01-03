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

    private const string FontFactorKey = "fontFactor";
    private const string LastLearntPerekKey = "lastLearntPerek";
    private const string PerekToLoadKey = "perekToLoad";
    private const string BookmarkedPerakimKey = "bookmarkedPerakim";

    private readonly IPreferencesStorage _storage;
    private double _fontFactor = 1.0;
    private int? _lastLearntPerek;
    private PerekToLoad _perekToLoad = PerekToLoad.LastLearnt;
    private HashSet<int> _bookmarkedPerakim = new();

    public event EventHandler? PreferencesChanged;

    private PreferencesService(IPreferencesStorage storage)
    {
        _storage = storage ?? throw new ArgumentNullException(nameof(storage));
    }

    /// <summary>
    /// Font size multiplier for text display.
    /// </summary>
    public double FontFactor
    {
        get => _fontFactor;
        set
        {
            if (Math.Abs(_fontFactor - value) < 0.001) return;
            _fontFactor = value;
            _storage.Set(FontFactorKey, value);
            OnPreferencesChanged();
        }
    }

    /// <summary>
    /// The last perek the user was learning (perek ID).
    /// </summary>
    public int? LastLearntPerek
    {
        get => _lastLearntPerek;
        set
        {
            if (_lastLearntPerek == value) return;
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
            if (_perekToLoad == value) return;
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
        _fontFactor = _storage.Get(FontFactorKey, 1.0);

        var lastLearnt = _storage.Get(LastLearntPerekKey, -1);
        _lastLearntPerek = lastLearnt >= 0 ? lastLearnt : null;

        _perekToLoad = (PerekToLoad)_storage.Get(PerekToLoadKey, (int)PerekToLoad.LastLearnt);

        var bookmarksJson = _storage.Get(BookmarkedPerakimKey, string.Empty);
        if (!string.IsNullOrEmpty(bookmarksJson))
        {
            try
            {
                var bookmarks = System.Text.Json.JsonSerializer.Deserialize<int[]>(bookmarksJson);
                _bookmarkedPerakim = bookmarks != null ? new HashSet<int>(bookmarks) : new HashSet<int>();
            }
            catch (Exception)
            {
                // Invalid JSON in bookmarks storage - silently reset to empty set
                _bookmarkedPerakim = new HashSet<int>();
            }
        }
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
        var json = System.Text.Json.JsonSerializer.Serialize(_bookmarkedPerakim.ToArray());
        _storage.Set(BookmarkedPerakimKey, json);
    }

    private void OnPreferencesChanged()
    {
        PreferencesChanged?.Invoke(this, EventArgs.Empty);
    }
}
