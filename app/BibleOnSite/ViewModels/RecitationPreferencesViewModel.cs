using System.Collections.ObjectModel;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

#pragma warning disable S2333 // ObservableProperty and RelayCommand generate partial implementations.
public partial class RecitationBookChoice : ObservableObject
{
    public required string Name { get; init; }
    public required List<int> PerekIds { get; init; }
    [ObservableProperty] private bool _isSelected;
    [ObservableProperty] private string _status = "";
}

public partial class RecitationPreferencesViewModel : ObservableObject
{
    private readonly RecitationService _recitation;
    private readonly PreferencesService _preferences;
    private readonly PerekDataService _perakim;
    private CancellationTokenSource? _download;
    public ObservableCollection<RecitationBookChoice> Books { get; } = [];
    public RecitationPreferencesViewModel() : this(RecitationService.Instance, PreferencesService.Instance, PerekDataService.Instance) { }
    public RecitationPreferencesViewModel(RecitationService recitation, PreferencesService preferences, PerekDataService perakim)
    {
        _recitation = recitation; _preferences = preferences; _perakim = perakim;
    }
    public bool IsInstalled => _recitation.IsInstalled;
    public bool Enabled
    {
        get => _preferences.RecitationEnabled;
        set { _preferences.RecitationEnabled = value && IsInstalled; OnPropertyChanged(); }
    }
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(IsIdle))] private bool _isDownloading;
    public bool IsIdle => !IsDownloading;
    [ObservableProperty] private double _progress;
    [ObservableProperty] private string _status = "התקינו הקראה לכל הספרים או לספרים שתבחרו.";

    public async Task LoadAsync()
    {
        try
        {
            await _recitation.InitializeAsync();
            await _perakim.LoadAsync();
            if (Books.Count == 0 && _perakim.Perakim is { } chapters)
            {
                foreach (var group in chapters.Values.GroupBy(p => p.SeferId).OrderBy(g => g.Key))
                {
                    Books.Add(new RecitationBookChoice { Name = group.First().SeferName, PerekIds = group.Select(p => p.PerekId).ToList(),
                        IsSelected = group.Any(p => _recitation.HasAudio(p.PerekId)) });
                }
            }

            Refresh();
        }
        catch (Exception) { Status = "לא ניתן לטעון את חבילת ההקראה. נסו להתקין אותה שוב."; }
    }

    private void Refresh()
    {
        foreach (var book in Books)
        {
            var available = book.PerekIds.Count(id => _recitation.GetTrack(id) != null);
            var installed = book.PerekIds.Count(_recitation.HasAudio);
            book.Status = !IsInstalled ? "זמינות תיבדק בעת ההורדה" : available == 0 ? "אין הקלטות זמינות" : $"{installed} מתוך {available} הקלטות מותקנות";
        }
        OnPropertyChanged(nameof(IsInstalled)); OnPropertyChanged(nameof(Enabled));
    }

    [RelayCommand] private void SelectAll() { foreach (var book in Books)
        {
            book.IsSelected = true;
        }
    }
    [RelayCommand] private void CancelDownload() => _download?.Cancel();

    [RelayCommand]
    public async Task DownloadSelectedAsync()
    {
        if (IsDownloading)
        {
            return;
        }

        var ids = Books.Where(b => b.IsSelected).SelectMany(b => b.PerekIds).ToArray();
        if (ids.Length == 0) { Status = "בחרו ספר אחד לפחות, או את כל הספרים."; return; }
        IsDownloading = true; Progress = 0;
        using var cancellation = new CancellationTokenSource();
        _download = cancellation;
        try
        {
            Status = "מעדכן את חבילת ההקראה...";
            await _recitation.UpdateAsync(cancellation.Token);
            Status = "מוריד הקלטות...";
            await _recitation.DownloadAsync(ids, new Progress<double>(p => { Progress = p; Status = $"מוריד הקלטות... {p:P0}"; }), cancellation.Token);
            Enabled = true;
            Status = "ההקלטות מותקנות וזמינות גם ללא אינטרנט.";
        }
        catch (OperationCanceledException) { Status = "ההורדה הופסקה. הקלטות שהושלמו נשמרו להמשך."; }
        catch (Exception) { Status = "לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו."; }
        finally { _download = null; IsDownloading = false; Refresh(); }
    }

    [RelayCommand]
    public async Task UpdateTimingsAsync()
    {
        if (IsDownloading)
        {
            return;
        }

        IsDownloading = true;
        using var cancellation = new CancellationTokenSource();
        _download = cancellation;
        try { await _recitation.UpdateAsync(cancellation.Token); Status = "חבילת ההקראה מעודכנת."; }
        catch (OperationCanceledException) { Status = "העדכון הופסק. החבילה המותקנת נשארה זמינה."; }
        catch (Exception) { Status = "העדכון לא הצליח. החבילה המותקנת נשארה זמינה."; }
        finally { _download = null; IsDownloading = false; Refresh(); }
    }
}
#pragma warning restore S2333
