using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class PreferencesServiceTests : IDisposable
{
    private readonly InMemoryPreferencesStorage _storage;
    private readonly PreferencesService _service;

    public PreferencesServiceTests()
    {
        _storage = new InMemoryPreferencesStorage();
        _service = PreferencesService.CreateForTesting(_storage);
    }

    public void Dispose()
    {
        PreferencesService.ResetForTesting();
    }

    [Fact]
    public void FontFactor_WhenSet_PersistsToStorage()
    {
        // Arrange
        var expectedFactor = 1.5;

        // Act
        _service.FontFactor = expectedFactor;

        // Assert
        _storage.Get("fontFactor", 0.0).Should().Be(expectedFactor);
    }

    [Fact]
    public void FontFactor_WhenChanged_RaisesPreferencesChangedEvent()
    {
        // Arrange
        var eventRaised = false;
        _service.PreferencesChanged += (_, _) => eventRaised = true;

        // Act
        _service.FontFactor = 2.0;

        // Assert
        eventRaised.Should().BeTrue();
    }

    [Fact]
    public void FontFactor_WhenSameValue_DoesNotRaiseEvent()
    {
        // Arrange
        _service.FontFactor = 1.0; // Default
        var eventCount = 0;
        _service.PreferencesChanged += (_, _) => eventCount++;

        // Act
        _service.FontFactor = 1.0;

        // Assert
        eventCount.Should().Be(0);
    }

    [Fact]
    public void LastLearntPerek_WhenSet_PersistsToStorage()
    {
        // Arrange & Act
        _service.LastLearntPerek = 42;

        // Assert
        _storage.Get("lastLearntPerek", -1).Should().Be(42);
    }

    [Fact]
    public void LastLearntPerek_WhenSetToNull_RemovesFromStorage()
    {
        // Arrange
        _service.LastLearntPerek = 42;

        // Act
        _service.LastLearntPerek = null;

        // Assert
        _storage.Get("lastLearntPerek", -1).Should().Be(-1);
    }

    [Fact]
    public void PerekToLoad_WhenSet_PersistsToStorage()
    {
        // Act — use LastLearnt since the default is already Todays (setter skips equal values)
        _service.PerekToLoad = PerekToLoad.LastLearnt;

        // Assert
        _storage.Get("perekToLoad", -1).Should().Be((int)PerekToLoad.LastLearnt);
    }

    [Fact]
    public void AddBookmark_AddsPerekToBookmarkedSet()
    {
        // Act
        _service.AddBookmark(5);

        // Assert
        _service.IsBookmarked(5).Should().BeTrue();
        _service.BookmarkedPerakim.Should().Contain(5);
    }

    [Fact]
    public void AddBookmark_WhenAlreadyBookmarked_DoesNotRaiseEvent()
    {
        // Arrange
        _service.AddBookmark(5);
        var eventCount = 0;
        _service.PreferencesChanged += (_, _) => eventCount++;

        // Act
        _service.AddBookmark(5);

        // Assert
        eventCount.Should().Be(0);
    }

    [Fact]
    public void RemoveBookmark_RemovesPerekFromBookmarkedSet()
    {
        // Arrange
        _service.AddBookmark(5);

        // Act
        _service.RemoveBookmark(5);

        // Assert
        _service.IsBookmarked(5).Should().BeFalse();
    }

    [Fact]
    public void ToggleBookmark_AddsWhenNotPresent()
    {
        // Act
        _service.ToggleBookmark(7);

        // Assert
        _service.IsBookmarked(7).Should().BeTrue();
    }

    [Fact]
    public void ToggleBookmark_RemovesWhenPresent()
    {
        // Arrange
        _service.AddBookmark(7);

        // Act
        _service.ToggleBookmark(7);

        // Assert
        _service.IsBookmarked(7).Should().BeFalse();
    }

    [Fact]
    public void Load_RestoresFontFactorFromStorage()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("fontFactor", 1.75);
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.FontFactor.Should().Be(1.75);
    }

    [Fact]
    public void Load_RestoresLastLearntPerekFromStorage()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("lastLearntPerek", 100);
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.LastLearntPerek.Should().Be(100);
    }

    [Fact]
    public void Load_WhenLastLearntPerekIsNegative_SetsToNull()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("lastLearntPerek", -1);
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.LastLearntPerek.Should().BeNull();
    }

    [Fact]
    public void Load_RestoresPerekToLoadFromStorage()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("perekToLoad", (int)PerekToLoad.Todays);
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.PerekToLoad.Should().Be(PerekToLoad.Todays);
    }

    [Fact]
    public void Load_RestoresBookmarksFromStorage()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("bookmarkedPerakim", "[1,2,3]");
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.BookmarkedPerakim.Should().BeEquivalentTo(new[] { 1, 2, 3 });
    }

    [Fact]
    public void Load_WhenBookmarksJsonIsInvalid_SetsEmptySet()
    {
        // Arrange
        var storage = new InMemoryPreferencesStorage();
        storage.Set("bookmarkedPerakim", "invalid json");
        var service = PreferencesService.CreateForTesting(storage);

        // Act
        service.Load();

        // Assert
        service.BookmarkedPerakim.Should().BeEmpty();
    }

    [Fact]
    public void Instance_WhenNotInitialized_ThrowsInvalidOperationException()
    {
        // Arrange
        PreferencesService.ResetForTesting();

        // Act & Assert
        var act = () => PreferencesService.Instance;
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*not initialized*");
    }

    [Fact]
    public void Initialize_SetsUpSingletonInstance()
    {
        // Arrange
        PreferencesService.ResetForTesting();
        var storage = new InMemoryPreferencesStorage();

        // Act
        PreferencesService.Initialize(storage);

        // Assert
        PreferencesService.Instance.Should().NotBeNull();
    }

    #region InMemoryPreferencesStorage Tests

    [Fact]
    public void InMemoryStorage_Remove_ShouldRemoveKey()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("key1", "value1");
        storage.Get("key1", "").Should().Be("value1");

        storage.Remove("key1");

        storage.Get("key1", "default").Should().Be("default");
    }

    [Fact]
    public void InMemoryStorage_Clear_ShouldRemoveAllKeys()
    {
        var storage = new InMemoryPreferencesStorage();
        storage.Set("key1", "value1");
        storage.Set("key2", 42);
        storage.Set("key3", true);

        storage.Clear();

        storage.Get("key1", "gone").Should().Be("gone");
        storage.Get("key2", -1).Should().Be(-1);
        storage.Get("key3", false).Should().BeFalse();
    }

    #endregion
}
