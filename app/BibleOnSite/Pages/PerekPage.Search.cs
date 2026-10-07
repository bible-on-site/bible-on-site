using BibleOnSite.Models;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private async void OnSearchResultSelected(object? sender, SearchResult result)
#pragma warning restore S1172
    {
        try
        {
            if (result is AuthorSearchResult author)
            {
                await Shell.Current.GoToAsync($"ArticlesPage?authorId={author.Author.Id}&authorName={Uri.EscapeDataString(author.Author.Name)}");
                return;
            }

            ResetRecitationContext();
            ShowPerekView();
            var perekId = result switch
            {
                PerekSearchResult chapter => chapter.Perek.PerekId,
                PasukSearchResult verse => verse.PerekId,
                PerushSearchResult commentary => commentary.PerekId,
                _ => 0
            };
            if (perekId == 0)
            {
                return;
            }
            await _viewModel.NavigateToPerekAsync(perekId);
            var pasukNum = result switch
            {
                PasukSearchResult verse => verse.Pasuk.PasukNum,
                PerushSearchResult commentary => commentary.PasukNum,
                _ => 0
            };
            if (result is PerushSearchResult note && int.TryParse(note.PerushId, out var perushId) && !_viewModel.IsPerushChecked(perushId))
            {
                _viewModel.ToggleCheckedPerush(perushId);
            }
            if (_viewModel.Perek?.Pasukim.FirstOrDefault(pasuk => pasuk.PasukNum == pasukNum) is { } pasuk)
            {
                await OpenFocusedPasukAsync(pasuk);
                if (result is PerushSearchResult)
                {
                    // Put the matching commentary first in the existing focused-verse reader.
                    var notes = _viewModel.GetPerushimForPasuk(pasukNum);
                    var perushName = result.Title.Split(" - ", StringSplitOptions.None)[0];
                    BindableLayout.SetItemsSource(FocusedPerushim, notes.OrderByDescending(item => item.PerushName == perushName).ToList());
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Search navigation failed: {ex}");
            await DisplayAlertAsync("חיפוש", "לא ניתן לפתוח את תוצאת החיפוש. נסו שוב", "אישור");
        }
    }
}
