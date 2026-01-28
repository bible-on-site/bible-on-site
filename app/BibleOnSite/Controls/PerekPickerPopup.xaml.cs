using BibleOnSite.Data;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

/// <summary>
/// A popup control for selecting a perek using a 3-column cascading picker.
/// Column 1: Sefer group (Torah, Neviim, Ketuvim)
/// Column 2: Sefer within the group
/// Column 3: Perek within the sefer
/// </summary>
public partial class PerekPickerPopup : ContentView
{
    private SeferGroupItem? _selectedGroup;
    private SeferItem? _selectedSefer;
    private PerekItem? _selectedPerek;

    /// <summary>
    /// Event raised when a perek is selected and confirmed.
    /// </summary>
    public event EventHandler<int>? PerekSelected;

    /// <summary>
    /// Event raised when the popup is dismissed.
    /// </summary>
    public event EventHandler? Dismissed;

    public PerekPickerPopup()
    {
        InitializeComponent();
        LoadSeferGroups();
    }

    /// <summary>
    /// Shows the picker popup.
    /// </summary>
    /// <param name="currentPerekId">Optional current perek ID to pre-select.</param>
    public void Show(int? currentPerekId = null)
    {
        IsVisible = true;

        if (currentPerekId.HasValue)
        {
            PreSelectPerek(currentPerekId.Value);
        }
    }

    /// <summary>
    /// Hides the picker popup.
    /// </summary>
    public void Hide()
    {
        IsVisible = false;
        Dismissed?.Invoke(this, EventArgs.Empty);
    }

    private void LoadSeferGroups()
    {
        var groups = new List<SeferGroupItem>
        {
            new() { Id = 1, Name = "תורה" },
            new() { Id = 2, Name = "נביאים" },
            new() { Id = 3, Name = "כתובים" }
        };

        SeferGroupList.ItemsSource = groups;
    }

    private void PreSelectPerek(int perekId)
    {
        var perek = PerekDataService.Instance.GetPerek(perekId);
        if (perek == null) return;

        var seferGroup = SefarimData.GetSeferGroup(perek.SeferId);

        // Select the group
        var groups = (List<SeferGroupItem>)SeferGroupList.ItemsSource;
        var groupItem = groups.FirstOrDefault(g => g.Id == (int)seferGroup);
        if (groupItem != null)
        {
            SeferGroupList.SelectedItem = groupItem;
            _selectedGroup = groupItem;

            // After group is selected, load sefarim and select the right sefer
            MainThread.BeginInvokeOnMainThread(async () =>
            {
                await Task.Delay(50); // Allow UI to update

                var sefarim = (List<SeferItem>?)SeferList.ItemsSource;
                if (sefarim != null)
                {
                    // Find the sefer with matching ID
                    var seferItem = sefarim.FirstOrDefault(s => s.SeferId == perek.SeferId);

                    if (seferItem != null)
                    {
                        SeferList.SelectedItem = seferItem;
                        _selectedSefer = seferItem;

                        await Task.Delay(50); // Allow UI to update

                        var perakim = (List<PerekItem>?)PerekList.ItemsSource;
                        if (perakim != null)
                        {
                            var perekItem = perakim.FirstOrDefault(p => p.PerekId == perekId);
                            if (perekItem != null)
                            {
                                PerekList.SelectedItem = perekItem;
                                _selectedPerek = perekItem;
                                UpdateConfirmButtonState();
                            }
                        }
                    }
                }
            });
        }
    }

    private void OnSeferGroupSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0) return;

        _selectedGroup = e.CurrentSelection[0] as SeferGroupItem;
        _selectedSefer = null;
        _selectedPerek = null;

        if (_selectedGroup == null) return;

        // Load sefarim for this group
        LoadSefarimForGroup(_selectedGroup.Id);
        PerekList.ItemsSource = null;
        UpdateConfirmButtonState();
    }

    private void LoadSefarimForGroup(int groupId)
    {
        var sefarim = new List<SeferItem>();
        var (from, to) = SefarimData.GetSeferGroupRange(groupId - 1); // 0-based index

        // Track the running perek ID to calculate the first perek ID for each sefer
        int currentPerekId = 1;
        for (int i = 1; i < from; i++)
        {
            currentPerekId += GetTotalPerakimForSefer(i);
        }

        for (int seferId = from; seferId <= to; seferId++)
        {
            var perakimData = PerakimData.PerakimOfBooks.GetValueOrDefault(seferId);
            var perek = PerekDataService.Instance.GetPerek(currentPerekId);
            var seferName = perek?.SeferName ?? $"ספר {seferId}";

            if (perakimData is int simpleCount)
            {
                // Simple book - use sefer name from database
                sefarim.Add(new SeferItem
                {
                    SeferId = seferId,
                    DisplayName = seferName,
                    HasAdditionals = false,
                    FirstPerekId = currentPerekId
                });
                currentPerekId += simpleCount;
            }
            else if (perakimData is Dictionary<int, int> additionalCounts)
            {
                // Book with additionals - strip the suffix (א/ב/ע/נ) from the name
                // The database stores "שמואל א" but we want just "שמואל"
                var baseName = seferName.TrimEnd(' ', 'א', 'ב', 'ע', 'נ').Trim();

                sefarim.Add(new SeferItem
                {
                    SeferId = seferId,
                    DisplayName = baseName,
                    HasAdditionals = true,
                    FirstPerekId = currentPerekId
                });

                // Advance past all additionals
                foreach (var (_, count) in additionalCounts)
                {
                    currentPerekId += count;
                }
            }
            else
            {
                // Unknown format - skip but log warning
                Console.Error.WriteLine($"Unknown perakim data format for sefer {seferId}: {perakimData?.GetType().Name ?? "null"}");
            }
        }

        SeferList.ItemsSource = sefarim;
    }

    private static int GetTotalPerakimForSefer(int seferId)
    {
        var perakimData = PerakimData.PerakimOfBooks.GetValueOrDefault(seferId);
        if (perakimData is int count)
            return count;
        if (perakimData is Dictionary<int, int> additionalCounts)
            return additionalCounts.Values.Sum();
        return 0;
    }

    private static string GetAdditionalLetter(int additional)
    {
        return additional switch
        {
            1 => "א",
            2 => "ב",
            3 => "ג",
            _ => additional.ToHebrewLetters()
        };
    }

    private void OnSeferSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0) return;

        _selectedSefer = e.CurrentSelection[0] as SeferItem;
        _selectedPerek = null;

        if (_selectedSefer == null) return;

        // Load perakim for this sefer
        LoadPerakimForSefer(_selectedSefer);
        UpdateConfirmButtonState();
    }

    private void LoadPerakimForSefer(SeferItem sefer)
    {
        var perakim = new List<PerekItem>();
        var perakimData = PerakimData.PerakimOfBooks.GetValueOrDefault(sefer.SeferId);

        if (perakimData is int simpleCount)
        {
            // Simple book - no additionals
            for (int i = 1; i <= simpleCount; i++)
            {
                var perekId = sefer.FirstPerekId + i - 1;
                perakim.Add(new PerekItem
                {
                    PerekId = perekId,
                    PerekNumber = i,
                    DisplayText = i.ToHebrewLetters()
                });
            }
        }
        else if (perakimData is Dictionary<int, int> additionalCounts)
        {
            // Book with additionals - include prefix for each perek
            int runningPerekId = sefer.FirstPerekId;
            // For עזרא/נחמיה (70, 50) use descending so ע comes before נ
            // For שמואל, מלכים, דברי הימים (1, 2) use ascending so א comes before ב
            var isEzra = additionalCounts.Keys.Any(k => k == 70 || k == 50);
            var orderedAdditionals = isEzra
                ? additionalCounts.OrderByDescending(x => x.Key)
                : additionalCounts.OrderBy(x => x.Key);

            foreach (var (additional, count) in orderedAdditionals)
            {
                var prefix = GetAdditionalPrefix(additional);
                for (int i = 1; i <= count; i++)
                {
                    perakim.Add(new PerekItem
                    {
                        PerekId = runningPerekId,
                        PerekNumber = i,
                        DisplayText = $"{prefix} {i.ToHebrewLetters()}"
                    });
                    runningPerekId++;
                }
            }
        }

        PerekList.ItemsSource = perakim;
    }

    private static string GetAdditionalPrefix(int additional)
    {
        // For עזרא/נחמיה: 70=עזרא, 50=נחמיה
        if (additional == 70) return "ע";
        if (additional == 50) return "נ";
        // For שמואל, מלכים, דברי הימים: 1=א, 2=ב
        return GetAdditionalLetter(additional);
    }

    private void OnPerekSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.Count == 0) return;

        _selectedPerek = e.CurrentSelection[0] as PerekItem;
        UpdateConfirmButtonState();
    }

    private void UpdateConfirmButtonState()
    {
        ConfirmButton.IsEnabled = _selectedPerek != null;
    }

    private void OnBackgroundTapped(object? sender, TappedEventArgs e)
    {
        Hide();
    }

    private void OnCancelClicked(object? sender, EventArgs e)
    {
        Hide();
    }

    private void OnConfirmClicked(object? sender, EventArgs e)
    {
        if (_selectedPerek != null)
        {
            PerekSelected?.Invoke(this, _selectedPerek.PerekId);
            Hide();
        }
    }

    #region Item Classes

    private class SeferGroupItem
    {
        public int Id { get; set; }
        public required string Name { get; set; }
    }

    private class SeferItem
    {
        public int SeferId { get; set; }
        public required string DisplayName { get; set; }
        public bool HasAdditionals { get; set; }
        public int FirstPerekId { get; set; }
    }

    private class PerekItem
    {
        public int PerekId { get; set; }
        public int PerekNumber { get; set; }
        public required string DisplayText { get; set; }
    }

    #endregion
}
