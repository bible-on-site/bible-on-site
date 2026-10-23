using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class CommentaryMemoryTests
{
    [Fact]
    public void MetadataAndFilteredDecodeDoNotAllocateExcludedText()
    {
        var blob = PerushNoteBlob.Encode([
            new(1, 1, 0, "selected"), new(2, 1, 0, new string('א', 1_000_000)),
            new(1, 2, 0, new string('ב', 1_000_000))]);
        _ = PerushNoteBlob.ReadHeaders(PerushNoteBlob.Encode([]));
        var before = GC.GetAllocatedBytesForCurrentThread();
        var headers = PerushNoteBlob.ReadHeaders(blob);
        var selected = PerushNoteBlob.Decode(blob, (source, verse) => source == 1 && verse == 1);
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        headers.Should().HaveCount(3);
        selected.Should().ContainSingle().Which.Content.Should().Be("selected");
        allocated.Should().BeLessThan(100_000, "four MB of excluded UTF-8 must be streamed through the skip buffer");
    }

    [Fact]
    public void PreferencesDoNotRetainClosedReaders()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var reader = CreateClosedReader(preferences);
        GarbageCollection.CollectCycles();
        reader.IsAlive.Should().BeFalse("the singleton preferences must not retain a closed reader and its commentary cache");
        preferences.FontFactor = 1.2;
        GC.KeepAlive(preferences);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void PreferencesDoNotRetainClosedSettingsScreens(int screen)
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var settings = CreateClosedSettings(preferences, screen);
        GarbageCollection.CollectCycles();
        settings.IsAlive.Should().BeFalse("category settings pages must not remain owned by singleton services");
        preferences.FontFactor = 1.2;
        GC.KeepAlive(preferences);
    }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static WeakReference CreateClosedSettings(PreferencesService preferences, int screen) =>
        new(screen switch
        {
            0 => (object)new PreferencesViewModel(preferences),
            1 => new PerekPreferencesViewModel(preferences),
            2 => new DisplayPreferencesViewModel(preferences),
            3 => new SoundPreferencesViewModel(preferences),
            _ => new RecitationPreferencesViewModel(RecitationService.Instance, preferences)
        });

    [Theory]
    [InlineData(8.6, 9)]
    [InlineData(0, 1)]
    [InlineData(101, 100)]
    [InlineData(double.NaN, 5)]
    public void ChapterSettingsPersistTheCommentaryLimit(double selected, int expected)
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var settings = new PerekPreferencesViewModel(preferences);
        settings.InlineCommentaryLimit = selected;
        settings.InlineCommentaryLimit.Should().Be(expected);
        var reloaded = PreferencesService.CreateForTesting(storage);
        reloaded.Load();
        reloaded.InlineCommentaryLimit.Should().Be(expected);
        var changed = new List<string?>();
        settings.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        preferences.InlineCommentaryLimit = 7;
        settings.InlineCommentaryLimit.Should().Be(7);
        changed.Should().Contain(nameof(PerekPreferencesViewModel.InlineCommentaryLimit));
    }

    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static WeakReference CreateClosedReader(PreferencesService preferences) =>
        new(new PerekViewModel(preferences, _ => null));

    [Fact]
    public void MetadataRejectsTruncatedExcludedContent()
    {
        var blob = PerushNoteBlob.Encode([new(1, 1, 0, "content")]);
        var broken = blob[..(blob.Length / 2)];
        Action read = () => PerushNoteBlob.ReadHeaders(broken);
        read.Should().Throw<IOException>();
    }

    [Fact]
    public async Task LazyDisplaysLoadOnlyTheirVerseAndSourceInNoteOrder()
    {
        var chapter = new PerushNoteChapter(PerushNoteBlob.Encode([
            new(1, 1, 1, "second"), new(2, 1, 0, "other source"),
            new(1, 1, 0, "first"), new(1, 2, 0, "other verse")]));
        List<Perush> sources = [new() { Id = 1, Name = "A" }, new() { Id = 2, Name = "B" }];
        var displays = chapter.GetDisplays(1, sources, new HashSet<int> { 1 });
        displays.Should().ContainSingle();
        displays[0].NoteContents.Should().BeEmpty();
        displays[0].DisplayContent.Should().BeEmpty();
        (await displays[0].ContentLoader!()).Should().Equal("first", "second");
        chapter.GetDisplays(2, sources).Should().ContainSingle();
        chapter.AvailablePerushIds(2, 2).Should().Equal(1);
    }

    [Fact]
    public async Task PasukSliceDecodesOncePerVerseAcrossPerushim()
    {
        var chapter = new PerushNoteChapter(PerushNoteBlob.Encode([
            new(1, 1, 0, "a1"), new(2, 1, 0, "b1"), new(1, 2, 0, "a2")]));
        List<Perush> sources = [new() { Id = 1, Name = "A" }, new() { Id = 2, Name = "B" }];
        var displays = chapter.GetDisplays(1, sources, new HashSet<int> { 1, 2 });
        (await displays[0].ContentLoader!()).Should().Equal("a1");
        (await displays[1].ContentLoader!()).Should().Equal("b1");
        chapter.DecodeScans.Should().Be(1, "every perush cell of the same pasuk shares one blob scan");
    }

    [Fact]
    public async Task PasukSliceCacheEvictsLeastRecentlyUsedVerse()
    {
        var chapter = new PerushNoteChapter(PerushNoteBlob.Encode(
            Enumerable.Range(1, 30).Select(p => new PerushNoteBlob.Note(1, p, 0, $"note {p}")).ToList()));
        List<Perush> sources = [new() { Id = 1, Name = "A" }];
        for (var p = 1; p <= 30; p++)
        {
            await chapter.GetDisplays(p, sources, new HashSet<int> { 1 })[0].ContentLoader!();
        }
        chapter.DecodeScans.Should().Be(30);
        await chapter.GetDisplays(30, sources, new HashSet<int> { 1 })[0].ContentLoader!();
        chapter.DecodeScans.Should().Be(30, "the most recent pasuk is still cached");
        await chapter.GetDisplays(1, sources, new HashSet<int> { 1 })[0].ContentLoader!();
        chapter.DecodeScans.Should().Be(31, "pasuk 1 fell out of the bounded slice cache");
    }

    [Fact]
    public void AddingACommentaryPreservesExistingDisplayObjects()
    {
        var chapter = new PerushNoteChapter(PerushNoteBlob.Encode([new(1, 1, 0, "A"), new(2, 1, 0, "B")]));
        List<Perush> sources = [new() { Id = 1, Name = "A" }, new() { Id = 2, Name = "B" }];
        var first = chapter.GetDisplays(1, sources, new HashSet<int> { 1 });
        var second = chapter.GetDisplays(1, sources, new HashSet<int> { 1, 2 }, first);
        second[0].Should().BeSameAs(first[0]);
    }

    [Fact]
    public void AddingASourceUpdatesNativeItemsWithoutResettingExistingCells()
    {
        var first = new PerushNoteDisplay { PerushId = 1, PerushName = "A" };
        var second = new PerushNoteDisplay { PerushId = 2, PerushName = "B" };
        var pasuk = new Pasuk { Text = "text", PerushNotes = [first] };
        var events = new List<System.Collections.Specialized.NotifyCollectionChangedAction>();
        pasuk.VisiblePerushNotes.CollectionChanged += (_, e) => events.Add(e.Action);
        pasuk.PerushNotes = [first, second];
        events.Should().Equal(System.Collections.Specialized.NotifyCollectionChangedAction.Add);
        pasuk.VisiblePerushNotes[0].Should().BeSameAs(first);
    }

    [Fact]
    public void ACellWithoutANativeHandlerDoesNotDecodeText()
    {
        var called = false;
        var view = new HtmlView { ContentLoader = () => { called = true; return Task.FromResult(new List<string> { "text" }); } };
        called.Should().BeFalse();
        view.HtmlContent.Should().BeNull();
    }

    [Fact]
    public async Task LazySearchJumpStillFindsTheExactSiblingNote()
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "A",
            ContentLoader = () => Task.FromResult(new List<string> { "ויאמר note 1", "ויאמר note 2" }) };
        var hit = new PerushSearchResult("1", "ויאמר note 2", 1, 1, "note 2");
        var target = await SearchMatch.ResolvePerushTargetAsync(hit, [display]);
        target.Should().NotBeNull();
        var content = string.Join(" ", await display.ContentLoader());
        var (start, end) = SearchMatch.ToRawRange(content, target!.Value.Span);
        content[start..end].Should().Be("note 2");
    }

    [Fact]
    public void MenuSearchFiltersNamesWithoutChangingInlineSelection()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var model = new PerekViewModel(preferences, _ => null)
        {
            Perushim = [new() { Id = 1, Name = "רש\"י" }, new() { Id = 2, Name = "ביאור שטיינזלץ" }]
        };
        model.ToggleCheckedPerush(1);
        model.PerushNameFilter = "שטיינזלץ";
        model.FilteredPerushim.Should().ContainSingle().Which.Id.Should().Be(2);
        model.CheckedPerushim.Should().Equal(1);
        model.PerushNameFilter = "רש״י";
        model.FilteredPerushim.Should().ContainSingle().Which.Id.Should().Be(1);
        model.PerushNameFilter = "missing";
        model.FilteredPerushim.Should().BeEmpty();
        model.PerushimEmptyMessage.Should().Be("לא נמצאו פירושים תואמים");
        model.PerushNameFilter = string.Empty;
        model.FilteredPerushim.Should().HaveCount(2);
    }

    [Fact]
    public void CommentaryLimitDefaultsToFiveAndPersistsAUserOverride()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        preferences.InlineCommentaryLimit.Should().Be(5);
        preferences.InlineCommentaryLimit = 9;
        var reloaded = PreferencesService.CreateForTesting(storage);
        reloaded.Load();
        reloaded.InlineCommentaryLimit.Should().Be(9);
    }

    [Fact]
    public void CommentaryLimitIsEnforcedAndSearchCanReplaceASlot()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var model = new PerekViewModel(preferences, _ => null);
        foreach (var id in Enumerable.Range(1, 6)) { model.ToggleCheckedPerush(id); }
        model.CheckedPerushim.Should().Equal(1, 2, 3, 4, 5);
        model.ShowPerushForSearch(6);
        model.CheckedPerushim.Should().Equal(1, 2, 3, 4, 6);
        preferences.InlineCommentaryLimit = 2;
        model.CheckedPerushim.Should().Equal(1, 2);
        preferences.InlineCommentaryLimit = 7;
        foreach (var id in Enumerable.Range(3, 5)) { model.ToggleCheckedPerush(id); }
        model.CheckedPerushim.Should().HaveCount(7);
    }
}
