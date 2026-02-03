using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Unit tests for PreferencesViewModel.
/// </summary>
public class PreferencesViewModelTests : IDisposable
{
    private readonly InMemoryPreferencesStorage _storage;
    private readonly PreferencesService _service;
    private readonly PreferencesViewModel _viewModel;

    public PreferencesViewModelTests()
    {
        _storage = new InMemoryPreferencesStorage();
        _service = PreferencesService.CreateForTesting(_storage);
        _viewModel = new PreferencesViewModel(_service);
    }

    public void Dispose()
    {
        PreferencesService.ResetForTesting();
    }

    #region FontFactor Tests

    [Fact]
    public void FontFactor_Get_ReturnsServiceValue()
    {
        // Arrange
        _service.FontFactor = 1.5;

        // Act & Assert
        _viewModel.FontFactor.Should().Be(1.5);
    }

    [Fact]
    public void FontFactor_Set_UpdatesServiceValue()
    {
        // Act
        _viewModel.FontFactor = 1.75;

        // Assert
        _service.FontFactor.Should().Be(1.75);
    }

    [Fact]
    public void FontFactor_WhenSameValue_DoesNotUpdate()
    {
        // Arrange
        _viewModel.FontFactor = 1.5;
        var eventCount = 0;
        _viewModel.PropertyChanged += (_, _) => eventCount++;

        // Act
        _viewModel.FontFactor = 1.5;

        // Assert
        eventCount.Should().Be(0, "Setting the same value should not raise PropertyChanged");
    }

    #endregion

    #region LastLearntPerek Tests

    [Fact]
    public void LastLearntPerek_Get_ReturnsServiceValue()
    {
        // Arrange
        _service.LastLearntPerek = 42;

        // Act & Assert
        _viewModel.LastLearntPerek.Should().Be(42);
    }

    [Fact]
    public void LastLearntPerek_Set_UpdatesServiceValue()
    {
        // Act
        _viewModel.LastLearntPerek = 100;

        // Assert
        _service.LastLearntPerek.Should().Be(100);
    }

    [Fact]
    public void LastLearntPerek_SetNull_UpdatesServiceValue()
    {
        // Arrange
        _viewModel.LastLearntPerek = 50;

        // Act
        _viewModel.LastLearntPerek = null;

        // Assert
        _service.LastLearntPerek.Should().BeNull();
    }

    #endregion

    #region PerekToLoad Tests

    [Fact]
    public void PerekToLoad_Get_ReturnsServiceValue()
    {
        // Arrange
        _service.PerekToLoad = PerekToLoad.Todays;

        // Act & Assert
        _viewModel.PerekToLoad.Should().Be(PerekToLoad.Todays);
    }

    [Fact]
    public void PerekToLoad_Set_UpdatesServiceValue()
    {
        // Act
        _viewModel.PerekToLoad = PerekToLoad.Todays;

        // Assert
        _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
    }

    #endregion

    #region LoadCommand Tests

    [Fact]
    public void LoadCommand_LoadsPreferencesFromStorage()
    {
        // Arrange
        _storage.Set("fontFactor", 1.8);
        _storage.Set("lastLearntPerek", 200);
        _storage.Set("perekToLoad", (int)PerekToLoad.Todays);

        // Act
        _viewModel.LoadCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(1.8);
        _viewModel.LastLearntPerek.Should().Be(200);
        _viewModel.PerekToLoad.Should().Be(PerekToLoad.Todays);
    }

    #endregion

    #region IncreaseFontSizeCommand Tests

    [Fact]
    public void IncreaseFontSizeCommand_IncreasesFontFactor()
    {
        // Arrange
        _viewModel.FontFactor = 1.0;

        // Act
        _viewModel.IncreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().BeApproximately(1.1, 0.01);
    }

    [Fact]
    public void IncreaseFontSizeCommand_DoesNotExceedMaximum()
    {
        // Arrange
        _viewModel.FontFactor = 1.95;

        // Act
        _viewModel.IncreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(2.0, "Font factor should cap at 2.0");
    }

    [Fact]
    public void IncreaseFontSizeCommand_AtMaximum_StaysAtMaximum()
    {
        // Arrange
        _viewModel.FontFactor = 2.0;

        // Act
        _viewModel.IncreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(2.0);
    }

    #endregion

    #region DecreaseFontSizeCommand Tests

    [Fact]
    public void DecreaseFontSizeCommand_DecreasesFontFactor()
    {
        // Arrange
        _viewModel.FontFactor = 1.0;

        // Act
        _viewModel.DecreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().BeApproximately(0.9, 0.01);
    }

    [Fact]
    public void DecreaseFontSizeCommand_DoesNotGoBelowMinimum()
    {
        // Arrange
        _viewModel.FontFactor = 0.55;

        // Act
        _viewModel.DecreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(0.5, "Font factor should not go below 0.5");
    }

    [Fact]
    public void DecreaseFontSizeCommand_AtMinimum_StaysAtMinimum()
    {
        // Arrange
        _viewModel.FontFactor = 0.5;

        // Act
        _viewModel.DecreaseFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(0.5);
    }

    #endregion

    #region ResetFontSizeCommand Tests

    [Fact]
    public void ResetFontSizeCommand_ResetsFontFactorToDefault()
    {
        // Arrange
        _viewModel.FontFactor = 1.5;

        // Act
        _viewModel.ResetFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(1.0);
    }

    [Fact]
    public void ResetFontSizeCommand_FromMinimum_ResetsFontFactorToDefault()
    {
        // Arrange
        _viewModel.FontFactor = 0.5;

        // Act
        _viewModel.ResetFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(1.0);
    }

    [Fact]
    public void ResetFontSizeCommand_FromMaximum_ResetsFontFactorToDefault()
    {
        // Arrange
        _viewModel.FontFactor = 2.0;

        // Act
        _viewModel.ResetFontSizeCommand.Execute(null);

        // Assert
        _viewModel.FontFactor.Should().Be(1.0);
    }

    #endregion

    #region PreferencesChanged Event Tests

    [Fact]
    public void ViewModel_WhenServicePreferencesChange_UpdatesProperties()
    {
        // Arrange
        var fontPropertyChanged = false;
        _viewModel.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(PreferencesViewModel.FontFactor))
                fontPropertyChanged = true;
        };

        // Act - change via service directly
        _service.FontFactor = 1.8;

        // Assert
        fontPropertyChanged.Should().BeTrue("PropertyChanged should fire when service preferences change");
    }

    #endregion
}
