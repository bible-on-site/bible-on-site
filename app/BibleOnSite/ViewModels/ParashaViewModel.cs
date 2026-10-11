using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using System.Collections.ObjectModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// The פרשה על הפרק reader: the parasha's Torah range followed by a
/// labeled הפטרה section for every custom variant, each rendering the
/// actual pesukim of its ordered ranges — including multi-range
/// readings and intentional repeats — clipped to the shared contract's
/// canonical bounds.
/// </summary>
public partial class ParashaViewModel : ObservableObject
{
    private readonly ParashaDataService _parashaService;
    private readonly PerekDataService _perekService;

    public ParashaViewModel() : this(ParashaDataService.Instance, PerekDataService.Instance) { }

    public ParashaViewModel(ParashaDataService parashaService, PerekDataService perekService)
    {
        _parashaService = parashaService;
        _perekService = perekService;
    }

    [ObservableProperty]
    private int _unitId;

    /// <summary>"פרשת בראשית" — the unit's identity heading.</summary>
    [ObservableProperty]
    private string _title = string.Empty;

    /// <summary>The Torah range in original references, e.g. "בראשית א א - ו ח".</summary>
    [ObservableProperty]
    private string _source = string.Empty;

    [ObservableProperty]
    private ObservableCollection<ParashaDisplayItem> _items = [];

    [ObservableProperty]
    private bool _isLoading;

    /// <summary>Whether a next parasha exists (וזאת הברכה has none).</summary>
    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(NextCommand))]
    private bool _canGoToNext;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(PreviousCommand))]
    private bool _canGoToPrevious;

    /// <summary>Loads the unit, its Torah text, and every Haftarah variant.</summary>
    public async Task LoadAsync(int unitId)
    {
        IsLoading = true;
        try
        {
            await _perekService.LoadAsync();
            await _parashaService.LoadAsync();

            var unit = _parashaService.GetParasha(unitId);
            if (unit is null)
            {
                Title = string.Empty;
                Source = string.Empty;
                Items = [];
                CanGoToNext = false;
                CanGoToPrevious = false;
                return;
            }

            UnitId = unit.UnitId;
            Title = $"פרשת {unit.Heading}";
            Source = RangeLabel(unit.TorahRange);
            CanGoToNext = _parashaService.GetParasha(unitId + 1) is not null;
            CanGoToPrevious = _parashaService.GetParasha(unitId - 1) is not null;

            var items = new List<ParashaDisplayItem>
            {
                ParashaDisplayItem.SectionHeader("תורה")
            };
            await AddReadingItemsAsync(items, [unit.TorahRange]);

            foreach (var haftara in unit.Haftarot)
            {
                items.Add(ParashaDisplayItem.SectionHeader($"הפטרה - {haftara.Label}"));
                await AddReadingItemsAsync(items, haftara.Ranges);
            }

            Items = new ObservableCollection<ParashaDisplayItem>(items);
        }
        finally { IsLoading = false; }
    }

    /// <summary>Navigates in place to the next parasha.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToNext))]
    private Task Next() => LoadAsync(UnitId + 1);

    /// <summary>Navigates in place to the previous parasha.</summary>
    [RelayCommand(CanExecute = nameof(CanGoToPrevious))]
    private Task Previous() => LoadAsync(UnitId - 1);

    /// <summary>
    /// Appends a per-perek subheader plus the clipped pesukim of every
    /// ordered range. Order, jumps, and repeats are preserved — no
    /// range is ever merged or filled.
    /// </summary>
    private async Task AddReadingItemsAsync(List<ParashaDisplayItem> items, IReadOnlyList<ScriptureRange> ranges)
    {
        foreach (var range in ranges)
        {
            foreach (var perekId in ParashaDataService.PerekIdsForRange(range))
            {
                items.Add(ParashaDisplayItem.PerekHeader(_perekService.GetPerekSource(perekId) ?? string.Empty));
                var pasukim = await _perekService.LoadPasukimAsync(perekId);
                foreach (var pasuk in ParashaDataService.ClipPasukim(pasukim, range, perekId))
                {
                    items.Add(ParashaDisplayItem.PasukItem(pasuk));
                }
            }
        }
    }

    /// <summary>
    /// Formats a range in original references: "בראשית א א" for a single
    /// pasuk, "בראשית א א-ח" inside one perek, "בראשית א א - ו ח" inside
    /// one sefer, and both full sources for a sefer jump
    /// ("ישעיהו מב ה - ירמיהו ב ג").
    /// </summary>
    private string RangeLabel(ScriptureRange range)
    {
        var startSource = _perekService.GetPerekSource(range.StartPerekId) ?? string.Empty;
        if (range.StartPerekId == range.EndPerekId)
        {
            return range.StartPasuk == range.EndPasuk
                ? $"{startSource} {range.StartPasuk.ToHebrewLetters()}"
                : $"{startSource} {range.StartPasuk.ToHebrewLetters()}-{range.EndPasuk.ToHebrewLetters()}";
        }

        var start = $"{startSource} {range.StartPasuk.ToHebrewLetters()}";
        var endPerek = _perekService.GetPerek(range.EndPerekId);
        var startPerek = _perekService.GetPerek(range.StartPerekId);
        var sameSefer = endPerek is not null
            && startPerek is not null
            && endPerek.SeferName == startPerek.SeferName
            && endPerek.Additional == startPerek.Additional;
        var endRef = sameSefer
            ? endPerek!.PerekNumber.ToHebrewLetters()
            : _perekService.GetPerekSource(range.EndPerekId) ?? string.Empty;
        return $"{start} - {endRef} {range.EndPasuk.ToHebrewLetters()}";
    }
}
