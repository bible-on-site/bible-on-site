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
    public T Get<T>(string key, T defaultValue)
    {
        return Preferences.Default.Get(key, defaultValue);
    }

    public void Set<T>(string key, T value)
    {
        Preferences.Default.Set(key, value);
    }

    public void Remove(string key)
    {
        Preferences.Default.Remove(key);
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
