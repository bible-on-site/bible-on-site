using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// The view-model surface <see cref="BibleOnSite.Controls.PerushimSheet"/> needs
/// from its host reader: the checked-state toggle pipeline and the
/// name-filtered list the picker's rows bind. Implemented by the perek,
/// parasha and masora reader view models.
/// </summary>
public interface IPerushimSheetViewModel
{
    /// <summary>The perushim matching the current name filter — the visible picker rows.</summary>
    List<Perush> FilteredPerushim { get; }

    /// <summary>Whether the perush is currently checked for inline display.</summary>
    bool IsPerushChecked(int perushId);

    /// <summary>Toggles the perush's checked state, honoring the inline limit.</summary>
    void ToggleCheckedPerush(int perushId);
}
