using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

public class RecitationTests
{
    private static RecitationTrack Valid() => new(1, "https://example.com/recordings/1_record.mp3", new string('a', 64),
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור"))),
        3000, "ready", [new(1, 1, "ברא", 100, 800), new(1, 2, "אור", 900, 1800)]);

    [Theory]
    [InlineData("identity")] [InlineData("url")] [InlineData("sourceHash")]
    [InlineData("duration")] [InlineData("status")] [InlineData("empty")]
    [InlineData("overlap")] [InlineData("missingTime")] [InlineData("nonfinite")]
    [InlineData("pastEnd")] [InlineData("duplicate")] [InlineData("changedText")]
    [InlineData("pendingWithWords")] [InlineData("zeroIdentity")] [InlineData("relativeUrl")]
    [InlineData("scheme")] [InlineData("query")] [InlineData("fragment")] [InlineData("wrongChapter")]
    [InlineData("textHash")] [InlineData("words")] [InlineData("zeroDuration")]
    public void InvalidCatalogCannotExposePartialOrAlteredWordTimings(string fault)
    {
        var track = Valid();
        track = fault switch
        {
            "identity" => track with { PerekId = 930 },
            "zeroIdentity" => track with { PerekId = 0 },
            "relativeUrl" => track with { AudioUrl = "recordings/1_record.mp3" },
            "url" => track with { AudioUrl = "https://user@example.com/recordings/1_record.mp3" },
            "scheme" => track with { AudioUrl = "ftp://example.com/recordings/1_record.mp3" },
            "query" => track with { AudioUrl = "https://example.com/recordings/1_record.mp3?other=1" },
            "fragment" => track with { AudioUrl = "https://example.com/recordings/1_record.mp3#other" },
            "wrongChapter" => track with { AudioUrl = "https://example.com/recordings/2_record.mp3" },
            "sourceHash" => track with { AudioSha256 = "incorrect" },
            "textHash" => track with { TextSha256 = "incorrect" },
            "words" => track with { Words = null! },
            "duration" => track with { DurationMs = double.NaN },
            "zeroDuration" => track with { DurationMs = 0 },
            "status" => track with { AlignmentStatus = "guessed" },
            "empty" => track with { Words = [] },
            "overlap" => track with { Words = [track.Words[0], track.Words[1] with { StartMs = 799 }] },
            "missingTime" => track with { Words = [track.Words[0] with { StartMs = null }, track.Words[1]] },
            "nonfinite" => track with { Words = [track.Words[0] with { EndMs = double.PositiveInfinity }, track.Words[1]] },
            "pastEnd" => track with { Words = [track.Words[0], track.Words[1] with { EndMs = 3001 }] },
            "duplicate" => track with { Words = [track.Words[0], track.Words[0]] },
            "changedText" => track with { Words = [track.Words[0] with { Text = "בדא" }, track.Words[1]] },
            _ => track with { AlignmentStatus = "pending" }
        };
        track.Invoking(t => t.Validate()).Should().Throw<InvalidDataException>();
    }

    [Fact]
    public void PackageRequiresSupportedVersion_AndUniqueChapters()
    {
        var track = Valid(); track.Validate();
        (track with { AlignmentStatus = "pending", Words = [] }).Validate();
        new RecitationPackage(1, [track]).Validate();
        foreach (var package in new[] { new RecitationPackage(2, [track]), new RecitationPackage(1, []), new RecitationPackage(1, [track, track]), new RecitationPackage(1, null!) })
        {
            package.Invoking(p => p.Validate()).Should().Throw<InvalidDataException>();
        }
    }

    [Fact]
    public void CanonicalMatchingPreservesNonspokenSegmentPositions_AndRequiresEveryWord()
    {
        var track = Valid();
        List<Pasuk> canonical = [new() { PasukNum = 1, Text = "ברא אור", Segments = [new() { Type = SegmentType.Qri, Value = "ברא" },
            new() { Type = SegmentType.Qri, Value = "אור" }] }];
        track.Matches(canonical).Should().BeTrue();
        (track with { Words = [track.Words[0]] }).Matches(canonical).Should().BeFalse();
        canonical[0].Segments.Insert(1, new() { Type = SegmentType.Stuma, Value = "" });
        track.Matches(canonical).Should().BeFalse("word ordinals cannot be shifted past a nonspoken segment");
    }

    [Fact]
    public void ClipRangesUseCamelCaseWireFormat()
    {
        List<RecitationClipRange> ranges = [new(100, 800)];
        var json = JsonSerializer.Serialize(ranges, RecitationJsonContext.Default.ClipRanges);
        json.Should().Be("[{\"start\":100,\"end\":800}]");
        JsonSerializer.Deserialize(json, RecitationJsonContext.Default.ClipRanges).Should().Equal(ranges);
    }

    [Theory]
    [InlineData("version")] [InlineData("package")] [InlineData("books")] [InlineData("emptyBooks")]
    [InlineData("nullBook")] [InlineData("chapterIds")] [InlineData("emptyChapterIds")]
    [InlineData("lowBookId")] [InlineData("highBookId")]
    [InlineData("emptyArchive")] [InlineData("oversizeArchive")]
    [InlineData("nullHash")] [InlineData("shortHash")] [InlineData("invalidHash")]
    [InlineData("duplicateBooks")] [InlineData("duplicateChapter")] [InlineData("missingChapter")]
    public void InvalidBookCatalogCannotRedirectOrPartiallyInstallAnExtension(string fault)
    {
        var book = new RecitationBookPack(1, new string('a', 64), 1000, [1]);
        var catalog = new RecitationExtensionCatalog(1, new(1, [Valid()]), [book]);
        catalog.Validate();
        catalog = fault switch
        {
            "version" => catalog with { Version = 2 },
            "package" => catalog with { Package = null! },
            "books" => catalog with { Books = null! },
            "emptyBooks" => catalog with { Books = [] },
            "nullBook" => catalog with { Books = [null!] },
            "chapterIds" => catalog with { Books = [book with { PerekIds = null! }] },
            "emptyChapterIds" => catalog with { Books = [book with { PerekIds = [] }] },
            "lowBookId" => catalog with { Books = [book with { SeferId = 0 }] },
            "highBookId" => catalog with { Books = [book with { SeferId = 40 }] },
            "emptyArchive" => catalog with { Books = [book with { SizeBytes = 0 }] },
            "oversizeArchive" => catalog with { Books = [book with { SizeBytes = 512_000_001 }] },
            "nullHash" => catalog with { Books = [book with { Sha256 = null! }] },
            "shortHash" => catalog with { Books = [book with { Sha256 = "short" }] },
            "invalidHash" => catalog with { Books = [book with { Sha256 = new string('z', 64) }] },
            "duplicateBooks" => catalog with { Books = [book, book] },
            "duplicateChapter" => catalog with { Books = [book with { PerekIds = [1, 1] }] },
            _ => catalog with { Books = [book with { PerekIds = [2] }] }
        };
        catalog.Invoking(c => c.Validate()).Should().Throw<InvalidDataException>();
    }
}
