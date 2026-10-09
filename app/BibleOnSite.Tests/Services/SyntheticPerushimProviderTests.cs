using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

// The provider fabricates the perushim data that PerushimCellsSurviveScrollStorm
// (iOS e2e) depends on; these tests pin its shape so the e2e cannot silently
// lose its HtmlView coverage.
public class SyntheticPerushimProviderTests
{
    [Fact]
    public void Enabled_IsFalseWithoutTheEnvironmentVariable()
    {
        // CI unit-test runs never set BIBLE_E2E_PERUSHIM.
        SyntheticPerushimProvider.Enabled.Should().BeFalse();
    }

    [Fact]
    public void Perushim_UsesNegativeIdsThatCannotCollideWithTheRealCatalog()
    {
        var perushim = SyntheticPerushimProvider.Perushim;

        perushim.Should().HaveCountGreaterThan(0);
        perushim.Should().OnlyContain(p => p.Id < 0);
        perushim.Select(p => p.Id).Should().OnlyHaveUniqueItems();
        perushim.Should().OnlyContain(p => !string.IsNullOrWhiteSpace(p.Name));
    }

    [Fact]
    public void NotesFor_EmitsOneNotePerPerushPerPasuk()
    {
        var perushim = SyntheticPerushimProvider.Perushim;
        var pasukNums = new[] { 3, 7 };

        var notes = SyntheticPerushimProvider.NotesFor(42, pasukNums);

        notes.Should().HaveCount(perushim.Count * pasukNums.Length);
        notes.Should().OnlyContain(n => n.PerekId == 42);
        notes.Select(n => n.Pasuk).Should().BeEquivalentTo(
            pasukNums.SelectMany(p => Enumerable.Repeat(p, perushim.Count)));
        foreach (var perush in perushim)
        {
            notes.Where(n => n.PerushId == perush.Id).Select(n => n.Pasuk)
                .Should().BeEquivalentTo(pasukNums);
        }
    }

    [Fact]
    public void NotesFor_ProducesHtmlContentThatExercisesTheParser()
    {
        var notes = SyntheticPerushimProvider.NotesFor(1, [1]);

        notes.Should().OnlyContain(n => !string.IsNullOrWhiteSpace(n.NoteContent));
        // The e2e exists to churn HtmlView: synthetic notes must carry the same
        // inline markup real perushim use so the managed parser runs for real.
        notes.Should().OnlyContain(n => n.NoteContent!.Contains('<'));
        notes.Should().Contain(n => n.NoteContent!.Contains("<b>"));
    }

    [Fact]
    public void NotesFor_AssignsSequentialNoteIndexesWithinEachPasuk()
    {
        var notes = SyntheticPerushimProvider.NotesFor(1, [5]);

        notes.Select(n => n.NoteIdx).Should().Equal(
            Enumerable.Range(0, SyntheticPerushimProvider.Perushim.Count));
    }
}
