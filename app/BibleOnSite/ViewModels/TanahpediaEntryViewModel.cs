using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SQLite;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for a single Tanahpedia entry - title, entity badges, HTML body
/// and the entry's Tanah occurrences. When the requested name belongs to a
/// synonym it resolves like the website: one target navigates straight to the
/// canonical entry, several render the disambiguation chooser, none show the
/// not-found state.
/// </summary>
#pragma warning disable S2333 // CommunityToolkit.Mvvm source generators supply the other partial declaration.
public partial class TanahpediaEntryViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly ITanahpediaService _service;
    private readonly IAppNavigator _navigator;
    private readonly PerekDataService _perekData;

    /// <summary>ExecuteAsync does not dedupe in-flight calls - rapid link or
    /// badge taps must not stack duplicate pushed pages (#2640).</summary>
    private readonly NavigationGate _navigationGate = new();

    /// <summary>A second Back trigger during an in-flight pop or absolute
    /// navigation must not consume another trail entry or page (#2640).</summary>
    private readonly NavigationGate _goBackGate = new();

    /// <summary>Person-to-person trail for in-place family-tree switches, so
    /// Back steps through prior people before leaving the page.</summary>
    private readonly Stack<string> _entryHistory = new();

    /// <summary>Cancels superseded in-place loads; combined with <see
    /// cref="_loadVersion"/> the latest requested entry always wins.</summary>
    private CancellationTokenSource? _loadCts;
    private int _loadVersion;

    /// <summary>True while a family-tree trail is pending above the entry
    /// the page was opened with.</summary>
    public bool HasEntryHistory => _entryHistory.Count > 0;

    public TanahpediaEntryViewModel() : this(
        TanahpediaService.Instance,
        ShellAppNavigator.Instance,
        PerekDataService.Instance)
    {
    }

    public TanahpediaEntryViewModel(ITanahpediaService service, IAppNavigator navigator, PerekDataService perekData)
    {
        _service = service;
        _navigator = navigator;
        _perekData = perekData;
    }

#pragma warning disable MVVMTK0045
    /// <summary>The requested name - canonical <c>unique_name</c> or a synonym.</summary>
    [ObservableProperty]
    private string _uniqueName = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    /// <summary>Loading finished (entry, disambiguation or not-found shown).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowEntry))]
    private bool _isLoaded;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? _errorMessage;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string? _content;

    /// <summary>"זמן קריאה משוער: X" badge over the entry body (issue #2607); null hides it.</summary>
    [ObservableProperty]
    private string? _readingTimeBadge;

    [ObservableProperty]
    private ObservableCollection<TanahpediaLinkedEntity> _entities = new();

    [ObservableProperty]
    private ObservableCollection<TanahpediaOccurrenceItem> _occurrences = new();

    /// <summary>Ambiguous-name targets - populated only in the disambiguation state.</summary>
    [ObservableProperty]
    private ObservableCollection<TanahpediaSynonymTarget> _synonymTargets = new();

    /// <summary>Family tree of the entry's PERSON entity - the source-backed
    /// relationship surface (הורים / בנות זוג / ילדים / אחים) rendered as the
    /// website's vertical card tree.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasFamily))]
    private TanahpediaFamilyTree? _familyTree;

    /// <summary>Map pins for the entry's PLACE entities.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasMap))]
    private List<TanahpediaPlaceMarker> _placeMarkers = [];

    /// <summary>True when the name resolved to several possible entries.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowEntry))]
    private bool _isDisambiguation;

    /// <summary>True when the name matches neither an entry nor any synonym.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowEntry))]
    private bool _isNotFound;
#pragma warning restore MVVMTK0045

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);
    public bool HasContent => !string.IsNullOrEmpty(Content);
    public bool HasEntities => Entities.Count > 0;
    public bool HasOccurrences => Occurrences.Count > 0;
    public bool HasFamily => FamilyTree is not null;
    public bool HasMap => PlaceMarkers.Count > 0;

    /// <summary>Empty-entry notice - the website shows it only when neither
    /// content, a map nor occurrences give the page a body.</summary>
    public bool ShowNoContentNotice => !HasContent && !HasMap && !HasOccurrences;

    /// <summary>Entry body is shown - loaded and not a disambiguation/not-found state.</summary>
    public bool ShowEntry => IsLoaded && !IsDisambiguation && !IsNotFound;

    /// <summary>
    /// Loads the entry by name, then resolves synonyms when no canonical entry
    /// owns it - mirroring the website's slug resolution (alias → single
    /// target, ambiguous → chooser, missing → not-found).
    /// </summary>
    [RelayCommand]
    public async Task LoadAsync()
    {
        if (IsLoading || UniqueName.Length == 0)
        {
            return;
        }

        await LoadCoreAsync(CancellationToken.None);
    }

    /// <summary>
    /// Shared load body. A newer load supersedes an in-flight one: stale
    /// responses are discarded by version and cancelled via <paramref name="ct"/>.
    /// </summary>
    private async Task LoadCoreAsync(CancellationToken ct)
    {
        var version = ++_loadVersion;
        IsLoading = true;
        ErrorMessage = null;
        IsNotFound = false;
        IsDisambiguation = false;

        try
        {
            var detail = await _service.GetEntryDetailAsync(UniqueName, ct);
            if (version != _loadVersion)
            {
                return;
            }
            if (detail != null)
            {
                await SetEntryAsync(detail);
                return;
            }

            var targets = await _service.GetSynonymTargetsAsync(UniqueName, ct);
            if (version != _loadVersion)
            {
                return;
            }
            if (targets.Count == 1)
            {
                // Plain alias - swap to the canonical entry (same UX as the
                // website's permanent redirect).
                var alias = await _service.GetEntryDetailAsync(targets[0].UniqueName, ct);
                if (version != _loadVersion)
                {
                    return;
                }
                if (alias != null)
                {
                    await SetEntryAsync(alias);
                    return;
                }
            }

            if (targets.Count > 0)
            {
                ResetEntryBody();
                SynonymTargets = new ObservableCollection<TanahpediaSynonymTarget>(targets);
                IsDisambiguation = true;
            }
            else
            {
                ResetEntryBody();
                IsNotFound = true;
            }
            IsLoaded = true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Superseded by a newer in-place switch - the newer load owns state.
        }
        #pragma warning disable S2221 // Deliberate failure boundary: entry load failure surfaces as ErrorMessage
        catch (Exception ex) //NOSONAR — entry load failure surfaces as ErrorMessage.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia entry load failed for {UniqueName}: {ex}");
            ErrorMessage = "התוכן אינו זמין כרגע";
            // The error pane is exclusive - a failed in-place switch must not
            // leave the previous entry's content rendered underneath (#2640).
            IsLoaded = false;
        }
        finally
        {
            if (version == _loadVersion)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>
    /// Rebinds this same view model to another entry in place (family-tree
    /// person hops): the previous entry's content stays under the loading
    /// overlay until the destination detail arrives, then everything swaps
    /// atomically - no page close/open transition.
    /// </summary>
    private async Task SwitchToCurrentEntryAsync()
    {
        _loadCts?.Cancel();
        _loadCts?.Dispose();
        var cts = _loadCts = new CancellationTokenSource();
        await LoadCoreAsync(cts.Token);
    }

    /// <summary>
    /// Clears the entry-body surface for a non-entry terminal state
    /// (disambiguation chooser, not-found): the toolbar title tracks the
    /// requested name and no title, entities, family tree, map or occurrence
    /// rows from a previously loaded entry may linger (#2640).
    /// </summary>
    private void ResetEntryBody()
    {
        Title = UniqueName;
        Content = null;
        ReadingTimeBadge = null;
        Entities = new ObservableCollection<TanahpediaLinkedEntity>();
        FamilyTree = null;
        PlaceMarkers = [];
        Occurrences = new ObservableCollection<TanahpediaOccurrenceItem>();
        SynonymTargets = new ObservableCollection<TanahpediaSynonymTarget>();
        OnPropertyChanged(nameof(HasContent));
        OnPropertyChanged(nameof(HasEntities));
        OnPropertyChanged(nameof(HasOccurrences));
        OnPropertyChanged(nameof(ShowNoContentNotice));
    }

    private async Task SetEntryAsync(TanahpediaEntryDetail detail)
    {
        // The destination may lack the previous entry's deferred sections -
        // reset them with the swap so no stale tree, map or rows linger.
        FamilyTree = null;
        PlaceMarkers = [];
        Occurrences = new ObservableCollection<TanahpediaOccurrenceItem>();
        SynonymTargets = new ObservableCollection<TanahpediaSynonymTarget>();

        Title = detail.Title;
        Content = TanahpediaFootnotes.Normalize(detail.Content);
        ReadingTimeBadge = detail.ReadingTimeBadge;
        Entities = new ObservableCollection<TanahpediaLinkedEntity>(detail.Entities);
        IsLoaded = true;
        OnPropertyChanged(nameof(HasContent));
        OnPropertyChanged(nameof(HasEntities));
        OnPropertyChanged(nameof(ShowNoContentNotice));

        await Task.WhenAll(
            LoadOccurrencesAsync(detail.Occurrences),
            LoadEntityExtrasAsync(detail));
        OnPropertyChanged(nameof(ShowNoContentNotice));
    }

    /// <summary>
    /// Loads the entity-level extras - the person family tree and the place
    /// markers - for the entry's linked entities. Both are secondary content:
    /// a failure drops the section rather than failing the page (same
    /// tolerance as occurrences and the website's try/catch around these
    /// loads).
    /// </summary>
    private async Task LoadEntityExtrasAsync(TanahpediaEntryDetail detail)
    {
        var tasks = new List<Task>();

        var person = detail.Entities.FirstOrDefault(e => e.EntityType == "PERSON");
        if (person is not null)
        {
            tasks.Add(LoadFamilyAsync(person.EntityId));
        }

        if (detail.Entities.Any(e => e.EntityType == "PLACE"))
        {
            tasks.Add(LoadMarkersAsync(detail.Id));
        }

        await Task.WhenAll(tasks);
    }

    private async Task LoadFamilyAsync(string entityId)
    {
        try
        {
            var family = await _service.GetPersonFamilyAsync(entityId, CancellationToken.None);
            if (family is not null)
            {
                FamilyTree = TanahpediaFamily.BuildTree(family);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: family-section load is best-effort
        catch (Exception ex) //NOSONAR — family-section load is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia family load failed for {entityId}: {ex}");
        }
    }

    private async Task LoadMarkersAsync(string entryId)
    {
        try
        {
            PlaceMarkers = await _service.GetPlaceMarkersAsync(entryId, CancellationToken.None) ?? [];
        }
        #pragma warning disable S2221 // Deliberate failure boundary: place-marker load is best-effort
        catch (Exception ex) //NOSONAR — place-marker load is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia place markers load failed for {entryId}: {ex}");
        }
    }

    /// <summary>
    /// Maps occurrences to display rows. Perek titles come from the local
    /// catalog; the pasuk text is loaded lazily from the bundled SQLite so the
    /// table shows a citation + verse like the website.
    /// </summary>
    private async Task LoadOccurrencesAsync(List<TanahpediaEntryOccurrence> occurrences)
    {
        try
        {
            if (!_perekData.IsLoaded)
            {
                await _perekData.LoadAsync();
            }

            var items = new List<TanahpediaOccurrenceItem>();
            var perekGroups = occurrences
                .Where(o => o.PerekId >= 1 && o.PerekId <= 929 && o.PasukNumber >= 1)
                .GroupBy(o => o.PerekId);

            foreach (var group in perekGroups)
            {
                var source = _perekData.GetPerekSource(group.Key) ?? string.Empty;
                List<Pasuk> pasukim;
                try
                {
                    pasukim = await _perekData.LoadPasukimAsync(group.Key);
                }
                catch (Exception ex) when (ex is SQLiteException or IOException)
                {
                    pasukim = [];
                }

                // One row per pasuk - several source ranges on the same verse
                // merge into a single citation, like the website's table.
                foreach (var (pasukNumber, ranges) in TanahpediaOccurrences.GroupRanges(group))
                {
                    var pasuk = pasukim.FirstOrDefault(p => p.PasukNum == pasukNumber);
                    items.Add(new TanahpediaOccurrenceItem
                    {
                        PerekId = group.Key,
                        PasukNumber = pasukNumber,
                        Citation = $"{source} {pasukNumber.ToHebrewLetters()}".Trim(),
                        VerseText = pasuk?.Text ?? string.Empty,
                        VerseFormatted = TanahpediaOccurrences.FormatVerse(
                            pasuk, ranges, pasuk?.Text ?? string.Empty),
                        SegmentRanges = ranges,
                    });
                }
            }

            Occurrences = new ObservableCollection<TanahpediaOccurrenceItem>(items);
            OnPropertyChanged(nameof(HasOccurrences));
        }
        #pragma warning disable S2221 // Deliberate failure boundary: occurrences mapping failure drops the table, not the page
        catch (Exception ex) //NOSONAR — occurrences mapping failure drops the table, not the page.
        {
            #pragma warning restore S2221
            // Occurrences are secondary - an empty table beats a failed page.
            Console.Error.WriteLine($"Tanahpedia occurrences mapping failed: {ex}");
        }
    }

    /// <summary>Opens an entry by its canonical unique name (internal links, alias rows).</summary>
    [RelayCommand]
    public async Task OpenEntryAsync(string? uniqueName)
    {
        if (string.IsNullOrEmpty(uniqueName) || uniqueName == UniqueName)
        {
            return;
        }

        await _navigationGate.RunAsync(() =>
            _navigator.GoToAsync($"tanahpediaEntry?uniqueName={Uri.EscapeDataString(uniqueName)}"));
    }

    /// <summary>
    /// Family-tree person hop: pushes the current name onto the entry trail
    /// and reloads this view model in place instead of pushing another page,
    /// which is what made person-to-person navigation visibly flicker.
    /// </summary>
    [RelayCommand]
    public async Task OpenPersonEntryAsync(string? uniqueName)
    {
        if (string.IsNullOrEmpty(uniqueName) || uniqueName == UniqueName)
        {
            return;
        }

        _entryHistory.Push(UniqueName);
        UniqueName = uniqueName;
        await SwitchToCurrentEntryAsync();
    }

    /// <summary>Opens the category listing a linked entity belongs to.</summary>
    [RelayCommand]
    public async Task OpenEntityCategoryAsync(TanahpediaLinkedEntity? entity)
    {
        if (entity is null)
        {
            return;
        }

        var category = TanahpediaTaxonomy.Find(entity.EntityType);
        var route = $"tanahpediaCategory?key={Uri.EscapeDataString(category?.Key ?? entity.EntityType)}" +
            $"&entityType={Uri.EscapeDataString(category?.EntityType ?? entity.EntityType)}";
        if (category?.Sub is { } sub)
        {
            route += $"&sub={Uri.EscapeDataString(sub)}";
        }
        await _navigationGate.RunAsync(() => _navigator.GoToAsync(route));
    }

    /// <summary>
    /// Navigates back: pops the in-place person trail first (same logical
    /// history the pushed pages used to give), then leaves the page.
    /// </summary>
    [RelayCommand]
    public async Task GoBackAsync()
    {
        await _goBackGate.RunAsync(async () =>
        {
            if (_entryHistory.Count > 0)
            {
                UniqueName = _entryHistory.Pop();
                await SwitchToCurrentEntryAsync();
                return;
            }

            await _navigator.GoToAsync("..");
        });
    }
}

/// <summary>One row in the entry's "מופעים בתנ\"ך" table.</summary>
public class TanahpediaOccurrenceItem
{
    public int PerekId { get; init; }
    public int PasukNumber { get; init; }

    /// <summary>Source citation, e.g. "שופטים טז ג".</summary>
    public string Citation { get; init; } = string.Empty;

    /// <summary>The pasuk text for context; empty when unavailable.</summary>
    public string VerseText { get; init; } = string.Empty;

    /// <summary>The pasuk rendered with its cited segments bold (the website's
    /// strong-occurrence rendering); falls back to <see cref="VerseText"/>.</summary>
    public FormattedString? VerseFormatted { get; init; }

    /// <summary>
    /// The merged 0-based segment ranges cited on this pasuk - preserved for
    /// the reader navigation (pasuk-level anchoring, same as the website's
    /// <c>#pasuk-N</c> anchor).
    /// </summary>
    public IReadOnlyList<(int? Start, int? End)> SegmentRanges { get; init; } = [];
}
