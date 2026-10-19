using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using SQLite;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Unit tests for PreferencesViewModel.
/// </summary>
[Collection(PreferencesServiceCollection.Name)]
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
        BibleOnSite.Helpers.DivineNameMasking.Apply(BibleOnSite.Helpers.DivineNameMaskingOptions.Disabled);
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

    #region הסתר שם השם Tests

    [Fact]
    public void DivineNameMaskingEnabled_Get_ReturnsServiceValue()
    {
        _service.DivineNameMaskingEnabled = false;

        _viewModel.DivineNameMaskingEnabled.Should().BeFalse();
    }

    [Fact]
    public void DivineNameMaskingEnabled_Set_UpdatesServiceValue()
    {
        _viewModel.DivineNameMaskingEnabled = false;

        _service.DivineNameMaskingEnabled.Should().BeFalse();
    }

    [Fact]
    public void DivineNameMaskingEnabled_WhenSameValue_DoesNotFirePropertyChanged()
    {
        _viewModel.DivineNameMaskingEnabled = false;
        var eventCount = 0;
        _viewModel.PropertyChanged += (_, _) => eventCount++;

        _viewModel.DivineNameMaskingEnabled = false;

        eventCount.Should().Be(0);
    }

    [Fact]
    public void DivineNameMaskElohim_Get_ReturnsServiceValue()
    {
        _service.DivineNameMaskElohim = BibleOnSite.Helpers.DivineNameMaskOption.Elokim;

        _viewModel.DivineNameMaskElohim.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Elokim);
    }

    [Fact]
    public void DivineNameMaskElohim_Set_UpdatesServiceAndNotifiesAllRadioWrappers()
    {
        var notified = new List<string>();
        _viewModel.PropertyChanged += (_, args) => notified.Add(args.PropertyName!);

        _viewModel.DivineNameMaskElohim = BibleOnSite.Helpers.DivineNameMaskOption.Elokim;

        _service.DivineNameMaskElohim.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Elokim);
        notified.Should().Contain([
            nameof(PreferencesViewModel.DivineNameMaskElohim),
            nameof(PreferencesViewModel.IsMaskElohimAsIs),
            nameof(PreferencesViewModel.IsMaskElohimElokim),
            nameof(PreferencesViewModel.IsMaskElohimHyphen),
            nameof(PreferencesViewModel.IsMaskElohimCustom)]);
    }

    [Theory]
    [InlineData(nameof(PreferencesViewModel.IsMaskElohimAsIs), BibleOnSite.Helpers.DivineNameMaskOption.AsIs)]
    [InlineData(nameof(PreferencesViewModel.IsMaskElohimElokim), BibleOnSite.Helpers.DivineNameMaskOption.Elokim)]
    [InlineData(nameof(PreferencesViewModel.IsMaskElohimHyphen), BibleOnSite.Helpers.DivineNameMaskOption.Hyphen)]
    [InlineData(nameof(PreferencesViewModel.IsMaskElohimCustom), BibleOnSite.Helpers.DivineNameMaskOption.Custom)]
    public void IsMaskElohim_SetTrue_SelectsTheOption(string property, BibleOnSite.Helpers.DivineNameMaskOption option)
    {
        var prop = typeof(PreferencesViewModel).GetProperty(property)!;

        prop.SetValue(_viewModel, true);

        _viewModel.DivineNameMaskElohim.Should().Be(option);
        prop.GetValue(_viewModel).Should().Be(true);
    }

    [Fact]
    public void IsMaskElohim_SetFalse_IsANoOpWriteBack()
    {
        _service.DivineNameMaskElohim = BibleOnSite.Helpers.DivineNameMaskOption.Elokim;

        _viewModel.IsMaskElohimAsIs = false;

        _service.DivineNameMaskElohim.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Elokim);
        _viewModel.IsMaskElohimAsIs.Should().BeFalse();
        _viewModel.IsMaskElohimElokim.Should().BeTrue();
    }

    [Fact]
    public void DivineNameMaskElohimCustom_GetSet_AndSameValueSkipsNotification()
    {
        _viewModel.DivineNameMaskElohimCustom = "אלופו";
        _service.DivineNameMaskElohimCustom.Should().Be("אלופו");
        _viewModel.DivineNameMaskElohimCustom.Should().Be("אלופו");

        var eventCount = 0;
        _viewModel.PropertyChanged += (_, _) => eventCount++;
        _viewModel.DivineNameMaskElohimCustom = "אלופו";

        eventCount.Should().Be(0);
    }

    [Fact]
    public void DivineNameMaskYhwh_Set_UpdatesServiceAndNotifiesAllRadioWrappers()
    {
        var notified = new List<string>();
        _viewModel.PropertyChanged += (_, args) => notified.Add(args.PropertyName!);

        _viewModel.DivineNameMaskYhwh = BibleOnSite.Helpers.DivineNameMaskOption.Dalet;

        _service.DivineNameMaskYhwh.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Dalet);
        notified.Should().Contain([
            nameof(PreferencesViewModel.DivineNameMaskYhwh),
            nameof(PreferencesViewModel.IsMaskYhwhHeh),
            nameof(PreferencesViewModel.IsMaskYhwhDalet),
            nameof(PreferencesViewModel.IsMaskYhwhCustom)]);
    }

    [Theory]
    [InlineData(nameof(PreferencesViewModel.IsMaskYhwhHeh), BibleOnSite.Helpers.DivineNameMaskOption.Heh)]
    [InlineData(nameof(PreferencesViewModel.IsMaskYhwhDalet), BibleOnSite.Helpers.DivineNameMaskOption.Dalet)]
    [InlineData(nameof(PreferencesViewModel.IsMaskYhwhCustom), BibleOnSite.Helpers.DivineNameMaskOption.Custom)]
    public void IsMaskYhwh_SetTrue_SelectsTheOption(string property, BibleOnSite.Helpers.DivineNameMaskOption option)
    {
        var prop = typeof(PreferencesViewModel).GetProperty(property)!;

        prop.SetValue(_viewModel, true);

        _viewModel.DivineNameMaskYhwh.Should().Be(option);
        prop.GetValue(_viewModel).Should().Be(true);
    }

    [Fact]
    public void IsMaskYhwh_SetFalse_IsANoOpWriteBack()
    {
        _service.DivineNameMaskYhwh = BibleOnSite.Helpers.DivineNameMaskOption.Dalet;

        _viewModel.IsMaskYhwhHeh = false;

        _service.DivineNameMaskYhwh.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Dalet);
        _viewModel.IsMaskYhwhHeh.Should().BeFalse();
        _viewModel.IsMaskYhwhDalet.Should().BeTrue();
    }

    [Fact]
    public void DivineNameMaskYhwhCustom_GetSet_AndSameValueSkipsNotification()
    {
        _viewModel.DivineNameMaskYhwhCustom = "השם";
        _service.DivineNameMaskYhwhCustom.Should().Be("השם");
        _viewModel.DivineNameMaskYhwhCustom.Should().Be("השם");

        var eventCount = 0;
        _viewModel.PropertyChanged += (_, _) => eventCount++;
        _viewModel.DivineNameMaskYhwhCustom = "השם";

        eventCount.Should().Be(0);
    }

    [Fact]
    public void DivineNameMaskEl_Set_UpdatesServiceAndNotifiesAllRadioWrappers()
    {
        var notified = new List<string>();
        _viewModel.PropertyChanged += (_, args) => notified.Add(args.PropertyName!);

        _viewModel.DivineNameMaskEl = BibleOnSite.Helpers.DivineNameMaskOption.Hyphen;

        _service.DivineNameMaskEl.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Hyphen);
        notified.Should().Contain([
            nameof(PreferencesViewModel.DivineNameMaskEl),
            nameof(PreferencesViewModel.IsMaskElAsIs),
            nameof(PreferencesViewModel.IsMaskElHyphen)]);
    }

    [Theory]
    [InlineData(nameof(PreferencesViewModel.IsMaskElAsIs), BibleOnSite.Helpers.DivineNameMaskOption.AsIs)]
    [InlineData(nameof(PreferencesViewModel.IsMaskElHyphen), BibleOnSite.Helpers.DivineNameMaskOption.Hyphen)]
    public void IsMaskEl_SetTrue_SelectsTheOption(string property, BibleOnSite.Helpers.DivineNameMaskOption option)
    {
        var prop = typeof(PreferencesViewModel).GetProperty(property)!;

        prop.SetValue(_viewModel, true);

        _viewModel.DivineNameMaskEl.Should().Be(option);
        prop.GetValue(_viewModel).Should().Be(true);
    }

    [Fact]
    public void IsMaskEl_SetFalse_IsANoOpWriteBack()
    {
        _service.DivineNameMaskEl = BibleOnSite.Helpers.DivineNameMaskOption.Hyphen;

        _viewModel.IsMaskElAsIs = false;

        _service.DivineNameMaskEl.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Hyphen);
        _viewModel.IsMaskElAsIs.Should().BeFalse();
        _viewModel.IsMaskElHyphen.Should().BeTrue();
    }

    [Fact]
    public void DivineNameMaskShaddai_Set_UpdatesServiceAndNotifiesAllRadioWrappers()
    {
        var notified = new List<string>();
        _viewModel.PropertyChanged += (_, args) => notified.Add(args.PropertyName!);

        _viewModel.DivineNameMaskShaddai = BibleOnSite.Helpers.DivineNameMaskOption.Custom;

        _service.DivineNameMaskShaddai.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Custom);
        notified.Should().Contain([
            nameof(PreferencesViewModel.DivineNameMaskShaddai),
            nameof(PreferencesViewModel.IsMaskShaddaiAsIs),
            nameof(PreferencesViewModel.IsMaskShaddaiHyphen),
            nameof(PreferencesViewModel.IsMaskShaddaiCustom)]);
    }

    [Theory]
    [InlineData(nameof(PreferencesViewModel.IsMaskShaddaiAsIs), BibleOnSite.Helpers.DivineNameMaskOption.AsIs)]
    [InlineData(nameof(PreferencesViewModel.IsMaskShaddaiHyphen), BibleOnSite.Helpers.DivineNameMaskOption.Hyphen)]
    [InlineData(nameof(PreferencesViewModel.IsMaskShaddaiCustom), BibleOnSite.Helpers.DivineNameMaskOption.Custom)]
    public void IsMaskShaddai_SetTrue_SelectsTheOption(string property, BibleOnSite.Helpers.DivineNameMaskOption option)
    {
        var prop = typeof(PreferencesViewModel).GetProperty(property)!;

        prop.SetValue(_viewModel, true);

        _viewModel.DivineNameMaskShaddai.Should().Be(option);
        prop.GetValue(_viewModel).Should().Be(true);
    }

    [Fact]
    public void IsMaskShaddai_SetFalse_IsANoOpWriteBack()
    {
        _service.DivineNameMaskShaddai = BibleOnSite.Helpers.DivineNameMaskOption.Hyphen;

        _viewModel.IsMaskShaddaiAsIs = false;

        _service.DivineNameMaskShaddai.Should().Be(BibleOnSite.Helpers.DivineNameMaskOption.Hyphen);
        _viewModel.IsMaskShaddaiAsIs.Should().BeFalse();
        _viewModel.IsMaskShaddaiHyphen.Should().BeTrue();
    }

    [Fact]
    public void DivineNameMaskShaddaiCustom_GetSet_AndSameValueSkipsNotification()
    {
        _viewModel.DivineNameMaskShaddaiCustom = "אל שדי";
        _service.DivineNameMaskShaddaiCustom.Should().Be("אל שדי");
        _viewModel.DivineNameMaskShaddaiCustom.Should().Be("אל שדי");

        var eventCount = 0;
        _viewModel.PropertyChanged += (_, _) => eventCount++;
        _viewModel.DivineNameMaskShaddaiCustom = "אל שדי";

        eventCount.Should().Be(0);
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

    #region Font-size commands (DisplayPreferencesViewModel)

    [Fact]
    public void IncreaseFontSizeCommand_IncreasesFontFactor()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 1.0;

        // Act
        display.IncreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().BeApproximately(1.1, 0.01);
    }

    [Fact]
    public void IncreaseFontSizeCommand_DoesNotExceedMaximum()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 1.95;

        // Act
        display.IncreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(2.0, "Font factor should cap at 2.0");
    }

    [Fact]
    public void IncreaseFontSizeCommand_AtMaximum_StaysAtMaximum()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 2.0;

        // Act
        display.IncreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(2.0);
    }

    #endregion

    #region DecreaseFontSizeCommand Tests

    [Fact]
    public void DecreaseFontSizeCommand_DecreasesFontFactor()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 1.0;

        // Act
        display.DecreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().BeApproximately(0.9, 0.01);
    }

    [Fact]
    public void DecreaseFontSizeCommand_DoesNotGoBelowMinimum()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 0.55;

        // Act
        display.DecreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(0.5, "Font factor should not go below 0.5");
    }

    [Fact]
    public void DecreaseFontSizeCommand_AtMinimum_StaysAtMinimum()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 0.5;

        // Act
        display.DecreaseFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(0.5);
    }

    #endregion

    #region ResetFontSizeCommand Tests

    [Fact]
    public void ResetFontSizeCommand_ResetsFontFactorToDefault()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 1.5;

        // Act
        display.ResetFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(1.0);
    }

    [Fact]
    public void ResetFontSizeCommand_FromMinimum_ResetsFontFactorToDefault()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 0.5;

        // Act
        display.ResetFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(1.0);
    }

    [Fact]
    public void ResetFontSizeCommand_FromMaximum_ResetsFontFactorToDefault()
    {
        // Arrange
        var display = new DisplayPreferencesViewModel(_service);
        display.FontFactor = 2.0;

        // Act
        display.ResetFontSizeCommand.Execute(null);

        // Assert
        display.FontFactor.Should().Be(1.0);
    }

    #endregion

    #region Category navigation (settings overview)

    [Fact]
    public async Task CategoryCommands_NavigateToEachDetailPage()
    {
        var navigator = new Mock<IAppNavigator>();
        var viewModel = new PreferencesViewModel(_service,
            PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), Path.Join(Path.GetTempPath(), Path.GetRandomFileName())),
            new RecitationService(new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object), navigator.Object);

        await viewModel.OpenDisplayCommand.ExecuteAsync(null);
        await viewModel.OpenPerekCommand.ExecuteAsync(null);
        await viewModel.OpenExtensionPacksCommand.ExecuteAsync(null);
        await viewModel.OpenRecitationCommand.ExecuteAsync(null);
        await viewModel.OpenSoundCommand.ExecuteAsync(null);
        await viewModel.OpenSupportCommand.ExecuteAsync(null);

        navigator.Verify(n => n.GoToAsync("DisplayPreferencesPage"), Times.Once);
        navigator.Verify(n => n.GoToAsync("PerekPreferencesPage"), Times.Once);
        navigator.Verify(n => n.GoToAsync("ExtensionPacksPage"), Times.Once);
        navigator.Verify(n => n.GoToAsync("RecitationPreferencesPage"), Times.Once);
        navigator.Verify(n => n.GoToAsync("SoundPreferencesPage"), Times.Once);
        navigator.Verify(n => n.GoToAsync("SupportPreferencesPage"), Times.Once);
    }

    [Fact]
    public async Task SoundChannels_RecitationVolumeSharesTheRecitationPreference()
    {
        var navigator = new Mock<IAppNavigator>();
        var sound = new SoundPreferencesViewModel(_service);
        var recitation = new RecitationPreferencesViewModel(
            new RecitationService(new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object),
            _service, navigator.Object);

        sound.RecitationVolume = 0.35;

        _service.RecitationVolume.Should().Be(0.35, "the שמע slider and the קריינות shortcut edit one setting");
        recitation.Volume.Should().Be(0.35);

        recitation.Volume = 0.7;
        sound.RecitationVolume.Should().Be(0.7);

        await recitation.OpenSoundCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync("SoundPreferencesPage?focus=recitation"), Times.Once);
        await recitation.OpenExtensionPacksCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync("ExtensionPacksPage"), Times.Once);
    }

    #endregion

    #region Overview summaries and sound channels

    [Fact]
    public void OverviewPerekToLoad_WhenChanged_UpdatesChoiceAndSummary()
    {
        _service.PerekToLoad = PerekToLoad.LastLearnt;

        _viewModel.PerekToLoad = PerekToLoad.Todays;

        _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
        _viewModel.IsPerekToLoadTodays.Should().BeTrue();
        _viewModel.IsPerekToLoadLastLearnt.Should().BeFalse();
        _viewModel.PerekToLoadSummary.Should().Be("הפרק של היום");
    }

    [Fact]
    public void OverviewPerekChoiceFlags_SelectEachStartupOption()
    {
        _service.PerekToLoad = PerekToLoad.LastLearnt;

        _viewModel.IsPerekToLoadTodays = true;
        _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
        _viewModel.IsPerekToLoadLastLearnt.Should().BeFalse();

        _viewModel.IsPerekToLoadLastLearnt = true;
        _service.PerekToLoad.Should().Be(PerekToLoad.LastLearnt);
        _viewModel.PerekToLoadSummary.Should().Be("האחרון שלמדתי");
    }

    [Fact]
    public void OverviewCategorySummaries_ReflectPackAndPlaybackState()
    {
        var navigator = new Mock<IAppNavigator>();
        var viewModel = new PreferencesViewModel(_service,
            PerushimNotesService.CreateForTesting(new FakePadDeliveryService(),
                Path.Join(Path.GetTempPath(), Path.GetRandomFileName())),
            new RecitationService(new Mock<IFileSystem>().Object, new Mock<IPadDeliveryService>().Object),
            navigator.Object);
        _service.RecitationSpeed = 1.5;
        _service.RecitationVolume = 0.7;
        _service.LessonsVolume = 0.5;
        _service.EffectsVolume = 0.4;

        viewModel.PerushimInstallStateText.Should().Be("לא מותקנת");
        viewModel.RecitationStateText.Should().Be("לא מותקנת");
        viewModel.PacksSummaryText.Should().Be("פירושים: לא מותקנת · קריינות: לא מותקנת");
        // Percent glyphs follow the ambient culture (e.g. "70%" vs "70 %"), so
        // derive expectations with the same format the view model uses.
        viewModel.RecitationPlaybackSummary.Should().Be($"מהירות 1.5× · עוצמה {0.7:P0}");
        viewModel.SoundSummaryText.Should().Be($"קריינות {0.7:P0} · שיעורים {0.5:P0} · אפקטים {0.4:P0}");
    }

    [Fact]
    public void SoundChannels_EachVolumePersistsIndependently()
    {
        var sound = new SoundPreferencesViewModel(_service);

        sound.RecitationVolume = 0.8;
        sound.LessonsVolume = 0.6;
        sound.EffectsVolume = 0.4;

        _service.RecitationVolume.Should().Be(0.8);
        _service.LessonsVolume.Should().Be(0.6);
        _service.EffectsVolume.Should().Be(0.4);
        sound.RecitationVolume.Should().Be(0.8);
        sound.LessonsVolume.Should().Be(0.6);
        sound.EffectsVolume.Should().Be(0.4);
    }

    [Fact]
    public void RecitationBookChoice_DerivesLifecycleFromOnDiskCounts()
    {
        var book = new RecitationBookChoice { Name = "יונה", PerekIds = [1] };
        book.AvailableCount = 4;

        book.ShowDownload.Should().BeTrue();
        book.DownloadLabel.Should().Be("הורדה");

        book.InstalledCount = 2;
        book.IsPartiallyInstalled.Should().BeTrue();
        book.DownloadLabel.Should().Be("השלמת הורדה");
        book.ShowRemove.Should().BeTrue();

        book.InstalledCount = 4;
        book.IsFullyInstalled.Should().BeTrue();
        book.IsPartiallyInstalled.Should().BeFalse();
        book.ShowDownload.Should().BeFalse();

        book.IsDownloading = true;
        book.ShowProgress.Should().BeTrue();
        book.ShowDownload.Should().BeFalse();
        book.ShowRemove.Should().BeFalse();
        book.HasInstalled.Should().BeTrue();
    }

    [Fact]
    public async Task RecitationPacksDownloadAll_WhenNoBooksOffered_ReportsUnavailable()
    {
        var fileSystem = new Mock<IFileSystem>();
        var viewModel = new RecitationPacksViewModel(
            new RecitationService(fileSystem.Object, new Mock<IPadDeliveryService>().Object),
            new PerekDataService(new LocalDatabaseService(fileSystem.Object)), new Mock<IAppNavigator>().Object);

        viewModel.RecitationStateText.Should().Be("לא מותקנת");

        await viewModel.DownloadAllCommand.ExecuteAsync(null);

        viewModel.Status.Should().Be("אין הקלטות זמינות להורדה.");
        viewModel.IsDownloading.Should().BeFalse();
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
            {
                fontPropertyChanged = true;
            }
        };

        // Act - change via service directly
        _service.FontFactor = 1.8;

        // Assert
        fontPropertyChanged.Should().BeTrue("PropertyChanged should fire when service preferences change");
    }

    #endregion

    /// <summary>
    /// Extension-pack install/remove paths on <see cref="ExtensionPacksViewModel"/> using
    /// <see cref="PerushimNotesService.CreateForTesting"/> and a fake PAD service.
    /// </summary>
    public sealed class PreferencesViewModelPerushimTests : IDisposable
    {
        private readonly string _tempDir;
        private readonly InMemoryPreferencesStorage _storage;
        private readonly PreferencesService _service;
        private readonly ExtensionPacksViewModel _viewModel;
        private readonly Mock<IAppNavigator> _navigator;

        public PreferencesViewModelPerushimTests()
        {
            _tempDir = Path.Join(Path.GetTempPath(), Path.GetRandomFileName());
            Directory.CreateDirectory(_tempDir);
            var fakePad = new FakePadDeliveryService();
            var perushim = PerushimNotesService.CreateForTesting(fakePad, _tempDir);
            _storage = new InMemoryPreferencesStorage();
            _service = PreferencesService.CreateForTesting(_storage);
            _navigator = new Mock<IAppNavigator>();
            var fileSystem = new Mock<IFileSystem>();
            _viewModel = new ExtensionPacksViewModel(perushim,
                new RecitationService(fileSystem.Object, new Mock<IPadDeliveryService>().Object),
                new PerekDataService(new LocalDatabaseService(fileSystem.Object)), _navigator.Object);
        }

        public void Dispose()
        {
            PreferencesService.ResetForTesting();
            try
            {
                if (Directory.Exists(_tempDir))
                {
                    Directory.Delete(_tempDir, true);
                }
            }
            catch (DirectoryNotFoundException)
            {
                // Best-effort cleanup of temp test directory.
            }
            catch (IOException)
            {
                // Best-effort cleanup of temp test directory.
            }
            catch (UnauthorizedAccessException)
            {
                // Best-effort cleanup of temp test directory.
            }
        }

        [Fact]
        public void IsPerekToLoadTodays_ReturnsTrue_WhenPerekToLoadIsTodays()
        {
            _service.PerekToLoad = PerekToLoad.Todays;

            new PerekPreferencesViewModel(_service).IsPerekToLoadTodays.Should().BeTrue();
        }

        [Fact]
        public void IsPerekToLoadTodays_SetTrue_SetsPerekToLoadToTodays()
        {
            _service.PerekToLoad = PerekToLoad.LastLearnt;

            var viewModel = new PerekPreferencesViewModel(_service) { IsPerekToLoadTodays = true };

            _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
            viewModel.PerekToLoad.Should().Be(PerekToLoad.Todays);
        }

        [Fact]
        public void IsPerekToLoadTodays_SetFalse_DoesNotChangePerekToLoad()
        {
            _service.PerekToLoad = PerekToLoad.Todays;

            new PerekPreferencesViewModel(_service).IsPerekToLoadTodays = false;

            _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
        }

        [Fact]
        public void IsPerekToLoadLastLearnt_ReturnsTrue_WhenPerekToLoadIsLastLearnt()
        {
            _service.PerekToLoad = PerekToLoad.LastLearnt;

            new PerekPreferencesViewModel(_service).IsPerekToLoadLastLearnt.Should().BeTrue();
        }

        [Fact]
        public void IsPerekToLoadLastLearnt_SetTrue_SetsPerekToLoadToLastLearnt()
        {
            _service.PerekToLoad = PerekToLoad.Todays;

            var viewModel = new PerekPreferencesViewModel(_service) { IsPerekToLoadLastLearnt = true };

            _service.PerekToLoad.Should().Be(PerekToLoad.LastLearnt);
            viewModel.PerekToLoad.Should().Be(PerekToLoad.LastLearnt);
        }

        [Fact]
        public void IsPerekToLoadLastLearnt_SetFalse_DoesNotChangePerekToLoad()
        {
            _service.PerekToLoad = PerekToLoad.LastLearnt;

            new PerekPreferencesViewModel(_service).IsPerekToLoadLastLearnt = false;

            _service.PerekToLoad.Should().Be(PerekToLoad.LastLearnt);
        }

        [Fact]
        public void PerekPreferenceCommands_SelectEachStartupChoice()
        {
            var viewModel = new PerekPreferencesViewModel(_service);

            viewModel.SelectLastLearntPerekCommand.Execute(null);
            _service.PerekToLoad.Should().Be(PerekToLoad.LastLearnt);
            viewModel.IsPerekToLoadLastLearnt.Should().BeTrue();

            viewModel.SelectTodaysPerekCommand.Execute(null);
            _service.PerekToLoad.Should().Be(PerekToLoad.Todays);
            viewModel.IsPerekToLoadTodays.Should().BeTrue();
        }

        [Fact]
        public void IsPerushimInstalled_ReturnsFalse_WhenNotesNotAvailable()
        {
            _viewModel.IsPerushimInstalled.Should().BeFalse();
        }

        [Fact]
        public void ShowPerushimDownload_ReturnsTrue_WhenNotesNotAvailable()
        {
            _viewModel.ShowPerushimDownload.Should().BeTrue();
        }

        [Fact]
        public void ShowPerushimDownloadButton_ReturnsFalse_WhileDownloading()
        {
            _viewModel.IsPerushimDownloading = true;

            _viewModel.ShowPerushimDownloadButton.Should().BeFalse();
        }

        [Fact]
        public void PerushimDownloadStatusText_ReturnsPercentage_WhenProgressWasReported()
        {
            _viewModel.PerushimDownloadProgress = 0.426;

            _viewModel.PerushimDownloadStatusText.Should().EndWith("43%");
        }

        [Fact]
        public void PerushimDownloadStatusText_ReturnsGenericMessage_BeforeProgressIsReported()
        {
            _viewModel.PerushimDownloadStatusText.Should().Be("מוריד…");
        }

        [Fact]
        public async Task ShowPerushimDownload_ReturnsFalse_WhenNotesAlreadyInstalled()
        {
            var dataDir = Path.Join(_tempDir, nameof(ShowPerushimDownload_ReturnsFalse_WhenNotesAlreadyInstalled));
            Directory.CreateDirectory(dataDir);
            var dbPath = Path.Join(dataDir, "sefaria-dump-5784-sivan-4.perushim_notes.sqlite");
            var conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create);
            foreach (var statement in NotesDbV2.Statements((1, 1, 1, 0, "note")))
            {
                await conn.ExecuteAsync(statement);
            }
            await conn.CloseAsync();

            var perushim = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
            await perushim.InitializeAsync();
            var fileSystem = new Mock<IFileSystem>();
            var viewModel = new ExtensionPacksViewModel(perushim,
                new RecitationService(fileSystem.Object, new Mock<IPadDeliveryService>().Object),
                new PerekDataService(new LocalDatabaseService(fileSystem.Object)), _navigator.Object);

            viewModel.ShowPerushimDownload.Should().BeFalse();
            viewModel.ShowPerushimDownloadButton.Should().BeFalse();
        }

        [Fact]
        public void PerushimNotesStatusText_ReturnsNotInstalledText_WhenNotAvailable()
        {
            _viewModel.PerushimNotesStatusText.Should().Be("חבילת הפירושים לא הותקנה. הורידו כדי להפעיל פירושים.");
        }

        [Fact]
        public void PerekToLoad_WhenSameValue_DoesNotFirePropertyChanged()
        {
            var viewModel = new PerekPreferencesViewModel(_service);
            viewModel.PerekToLoad = PerekToLoad.Todays;
            var eventCount = 0;
            viewModel.PropertyChanged += (_, _) => eventCount++;

            viewModel.PerekToLoad = PerekToLoad.Todays;

            eventCount.Should().Be(0);
        }

        [Fact]
        public void LastLearntPerek_WhenSameValue_DoesNotFirePropertyChanged()
        {
            var viewModel = new PreferencesViewModel(_service);
            viewModel.LastLearntPerek = 7;
            var eventCount = 0;
            viewModel.PropertyChanged += (_, _) => eventCount++;

            viewModel.LastLearntPerek = 7;

            eventCount.Should().Be(0);
        }

        [Fact]
        public async Task DownloadPerushimAsync_WhenAlreadyDownloading_ReturnsWithoutFetching()
        {
            _viewModel.IsPerushimDownloading = true;

            await _viewModel.DownloadPerushimCommand.ExecuteAsync(null);

            _viewModel.IsPerushimDownloading.Should().BeTrue();
        }

        [Fact]
        public async Task DownloadPerushimAsync_WhenDownloadFails_ResetsStateAndKeepsClampedProgress()
        {
            var fakePad = new FakePadDeliveryService { ProgressReports = [1.5] };
            var perushim = PerushimNotesService.CreateForTesting(fakePad, _tempDir);
            var fileSystem = new Mock<IFileSystem>();
            var viewModel = new ExtensionPacksViewModel(perushim,
                new RecitationService(fileSystem.Object, new Mock<IPadDeliveryService>().Object),
                new PerekDataService(new LocalDatabaseService(fileSystem.Object)), _navigator.Object);

            await viewModel.DownloadPerushimCommand.ExecuteAsync(null);
            // Progress<T>.Report dispatches asynchronously; wait until the report applies.
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (viewModel.PerushimDownloadProgress < 1 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(10, TestContext.Current.CancellationToken);
            }

            fakePad.FetchCalls.Should().Be(1);
            viewModel.IsPerushimDownloading.Should().BeFalse();
            viewModel.PerushimDownloadProgress.Should().Be(1);
            viewModel.ShowPerushimDownloadButton.Should().BeTrue();
        }
    }

    private sealed class FakePadDeliveryService : IPadDeliveryService
    {
        public List<double> ProgressReports { get; init; } = [];

        public int FetchCalls { get; private set; }

        public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(null);

        public Task<bool> FetchAsync(string packName, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
        {
            _ = packName;
            _ = cancellationToken;
            FetchCalls++;
            foreach (var value in ProgressReports)
            {
                progress?.Report(value);
            }
            return Task.FromResult(false);
        }

        public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName) =>
            Task.FromResult(new List<string>());
    }
}
