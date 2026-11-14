using BibleOnSite.ViewModels;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// <see cref="BibleOnSite.Controls.PerushimSheet"/> reaches its host view model
/// through <see cref="IPerushimSheetViewModel"/> — a reader VM missing the
/// interface silently disables perush toggling and search-scroll.
/// </summary>
public class PerushimSheetContractTests
{
    [Theory]
    [InlineData(typeof(PerekViewModel))]
    [InlineData(typeof(ParashaViewModel))]
    [InlineData(typeof(MasoraViewModel))]
    public void ReaderViewModels_ImplementPerushimSheetContract(Type viewModelType)
    {
        typeof(IPerushimSheetViewModel).IsAssignableFrom(viewModelType).Should().BeTrue(
            $"{viewModelType.Name} hosts PerushimSheet, which casts its BindingContext " +
            "to IPerushimSheetViewModel — without it, checkbox toggles no-op");
    }
}
