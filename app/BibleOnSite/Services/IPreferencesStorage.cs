namespace BibleOnSite.Services;

/// <summary>
/// Interface for preferences storage abstraction.
/// Allows for testing without MAUI dependencies.
/// </summary>
public interface IPreferencesStorage
{
    T Get<T>(string key, T defaultValue);
    void Set<T>(string key, T value);
    void Remove(string key);
}

#if MAUI
/// <summary>
/// MAUI implementation of preferences storage.
/// </summary>
public class MauiPreferencesStorage : IPreferencesStorage
{
    private readonly IPreferences _preferences;

    public MauiPreferencesStorage() : this(Preferences.Default) { }

    public MauiPreferencesStorage(IPreferences preferences) { _preferences = preferences; }

    public T Get<T>(string key, T defaultValue)
    {
        return _preferences.Get(key, defaultValue);
    }

    public void Set<T>(string key, T value)
    {
        _preferences.Set(key, value);
    }

    public void Remove(string key)
    {
        _preferences.Remove(key);
    }
}
#endif

/// <summary>
/// In-memory implementation of preferences storage for testing.
/// </summary>
public class InMemoryPreferencesStorage : IPreferencesStorage
{
    private readonly Dictionary<string, object?> _storage = new();

    public T Get<T>(string key, T defaultValue)
    {
        if (_storage.TryGetValue(key, out var value) && value is T typedValue)
        {
            return typedValue;
        }
        return defaultValue;
    }

    public void Set<T>(string key, T value)
    {
        _storage[key] = value;
    }

    public void Remove(string key)
    {
        _storage.Remove(key);
    }

    public void Clear()
    {
        _storage.Clear();
    }
}
