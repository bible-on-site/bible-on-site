using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;
using System.Reflection;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// #2078 search-jump coverage: perush displays carry note identity, the matched
/// note inside a combined display resolves to its own span (not the first
/// arbitrary occurrence), and the HtmlView match API reports its contract.
/// </summary>
public class SearchResultJumpTests
{
    [Fact]
    public void CheckedPerushDisplaysCarryThePerushId()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        vm.ToggleCheckedPerush(2);

        vm.Perek!.Pasukim[0].PerushNotes.Should().ContainSingle()
            .Which.PerushId.Should().Be(2, "the display must identify its perush after grouping");
    }

    [Fact]
    public void FocusedVerseDisplaysCarryThePerushId()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        var focused = vm.GetPerushimForPasuk(1);

        focused.Select(display => display.PerushId).Should().Equal(1, 2);
    }

    [Fact]
    public void ResolvesTheMatchedNoteInsideACombinedDisplay()
    {
        var vm = CreateViewModelWithPerushimAndNotes();
        vm.ToggleCheckedPerush(1);
        var display = vm.Perek!.Pasukim[2].PerushNotes.Should().ContainSingle().Subject;

        // The hit names the SECOND note row (note_idx 1) — the query words also
        // appear in the first note, so identity must come from the note text.
        var hit = new PerushSearchResult("1", "ויאמר - note 2", 1, 3, "note 2");

        var target = SearchMatch.ResolvePerushTarget(hit, new List<PerushNoteDisplay> { display });

        target.Should().NotBeNull();
        target!.Value.Display.Should().BeSameAs(display);

        // Project the normalized span onto the rendered joined HTML — it must
        // cover "note 2" of the second note, not the first note's copy.
        var (start, end) = SearchMatch.ToRawRange(display.DisplayContent, target!.Value.Span);
        display.DisplayContent[start..end].Should().Be("note 2");
        start.Should().Be(display.DisplayContent.LastIndexOf("note 2", StringComparison.Ordinal));
    }

    [Fact]
    public void PasukResultMapsToTheFirstDisplayCopy()
    {
        // The reader scrolls to PasukDisplayItem rows — the first copy carries
        // the pasuk marker and perushim that the jump targets.
        var pasuk = new Pasuk { PasukNum = 3, Text = "ויאמר" };
        var items = PasukDisplayItems.Create([pasuk], repeatEachPasuk: true, fontFactor: 1.0);

        var target = items.FirstOrDefault(item => item.IsFirstCopy && item.PasukNum == 3);

        target.Should().BeSameAs(items[0]);
        items[1].IsRepeatedCopy.Should().BeTrue();
    }

    [Fact]
    public void ArticleResultCarriesTheJumpContext()
    {
        // The article page needs the ranked excerpt + phrase to anchor the
        // exact occurrence after async content build (#2078).
        var hit = new ArticleSearchResult(42, 7, "הרב לוי", "בראשית א", "חלון ציטוט", "מונח");

        hit.ArticleId.Should().Be(42);
        hit.PerekId.Should().Be(7);
        hit.Excerpt.Should().Be("חלון ציטוט");
        hit.SearchPhrase.Should().Be("מונח");
        hit.ResultType.Should().Be(SearchFilter.Articles);
    }

    [Fact]
    public void HtmlViewSearchMatchApiDefaultsToNoMatch()
    {
        var view = new HtmlView();

        view.HasSearchMatch.Should().BeFalse();
        view.SearchMatchStart.Should().Be(-1);
        view.GetSearchMatchTop().Should().BeNull("no handler is attached");
        HtmlView.CanMeasureSearchMatch.Should().BeFalse(
            "the test host is not one of the measured platforms");
    }

    [Fact]
    public void HtmlViewSearchMatchApiReportsASpan()
    {
        var view = new HtmlView
        {
            SearchMatchStart = 4,
            SearchMatchLength = 6
        };

        view.HasSearchMatch.Should().BeTrue();
        view.SearchMatchLength.Should().Be(6);
    }

    private static PerekViewModel CreateViewModelWithPerushimAndNotes()
    {
        var perek = new Perek
        {
            PerekId = 1,
            PerekNumber = 1,
            Date = "2026-01-20",
            HebDate = "תשרי",
            HasRecording = false,
            Header = "Header",
            SeferId = 1,
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "18:00",
            Pasukim = new List<Pasuk>
            {
                new() { PasukNum = 1, Text = "בראשית ברא אלהים" },
                new() { PasukNum = 2, Text = "והארץ היתה תהו ובהו" },
                new() { PasukNum = 3, Text = "ויאמר אלהים יהי אור" },
            }
        };
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var vm = new PerekViewModel(preferences, _ => perek);
        vm.LoadByPerekId(1);
        vm.Perushim = new List<Perush>
        {
            new() { Id = 1, Name = "רש\"י", Priority = 100 },
            new() { Id = 2, Name = "אבן עזרא", Priority = 200 },
        };

        var notes = new List<PerekPerushNote>
        {
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 1, NoteIdx = 0, NoteContent = "בראשית - בשביל התורה" },
            new() { PerushId = 2, PerushName = "אבן עזרא", PerekId = 1, Pasuk = 1, NoteIdx = 0, NoteContent = "בראשית ברא - הפועל" },
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 3, NoteIdx = 0, NoteContent = "ויאמר - note 1" },
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 3, NoteIdx = 1, NoteContent = "ויאמר - note 2" },
        };
        typeof(PerekViewModel)
            .GetField("_perushNotesCache", BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(vm, notes);
        return vm;
    }
}
