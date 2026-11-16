using System.Text.Json;
using System.Text.Json.Nodes;
using Serilog;
using Xunit;

public sealed class MsStoreSubmissionTests
{
    const string Notes = "עדכון חדש";
    const string Draft = """{"id":"draft","listings":{"he-il":{"baseListing":{"releaseNotes":"old"}}}}""";

    [Fact]
    public void ActualProcessReadsOnlyStdoutAndNeverParsesProgressOrStderrJson()
    {
        var submission = ReadProbe("valid", 0);
        Assert.Equal("draft", submission["id"]!.GetValue<string>());
        Assert.Equal("stdout notes", submission["listings"]!["he-il"]!["baseListing"]!["releaseNotes"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("malformed")]
    [InlineData("empty")]
    public void ActualProcessCannotRecoverInvalidStdoutFromPlausibleStderr(string scenario) =>
        Assert.ThrowsAny<JsonException>(() => ReadProbe(scenario, 0));

    [Theory]
    [InlineData("null")]
    [InlineData("array")]
    public void ActualProcessRejectsWrongRoot(string scenario) =>
        Assert.Throws<InvalidOperationException>(() => ReadProbe(scenario, 0));

    [Fact]
    public void NonzeroExitCannotBeAcceptedEvenWithValidStdout()
    {
        var failure = Assert.Throws<InvalidOperationException>(() => ReadProbe("valid", 19));
        Assert.Contains("exit 19", failure.Message);
    }

    static JsonObject ReadProbe(string scenario, int exitCode)
    {
        var probe = Path.Join(AppContext.BaseDirectory, "coverage-scheduling-probe", "CoverageEndpointProbe.dll");
        return MsStoreSubmission.Read("dotnet", $"\"{probe}\" msstore-submission {scenario} {exitCode}");
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("true")]
    [InlineData("42")]
    [InlineData("\"object\"")]
    [InlineData("{\"listings\":{},\"Listings\":{}}")]
    [InlineData("{\"listings\":{\"he-il\":{},\"HE-IL\":{}}}")]
    [InlineData("{\"other\":[{\"x\":1,\"X\":2}]}")]
    [InlineData("{\"id\":1,\"id\":2}")]
    public void WrongRootAndAmbiguousNamesCannotBeTreatedAsMissingMetadata(string json) =>
        Assert.Throws<InvalidOperationException>(() => MsStoreSubmission.Parse(json));

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"listings\":null}")]
    [InlineData("{\"listings\":{}}")]
    [InlineData("{\"listings\":{\"en-us\":{\"baseListing\":{}}}}")]
    [InlineData("{\"listings\":{\"he-il\":{}}}")]
    [InlineData("{\"listings\":{\"he-il\":{\"baseListing\":null}}}")]
    public void VerifiedAbsenceSkipsOnlyNotesAndStillCommitsOnce(string json)
    {
        var events = new List<string>();
        var applied = Publish(() => { events.Add("read"); return MsStoreSubmission.Parse(json); },
            _ => events.Add("update"), () => events.Add("commit"));
        Assert.False(applied);
        Assert.Equal(new[] { "read", "commit" }, events);
    }

    [Theory]
    [InlineData("not JSON")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"listings\":[]}")]
    [InlineData("{\"listings\":false}")]
    [InlineData("{\"listings\":{\"he-il\":null}}")]
    [InlineData("{\"listings\":{\"he-il\":[]}}")]
    [InlineData("{\"listings\":{\"he-il\":{\"baseListing\":[]}}}")]
    [InlineData("{\"listings\":{\"he-il\":{\"baseListing\":{\"releaseNotes\":10}}}}")]
    [InlineData("{\"listings\":{\"he-il\":{},\"he\":{}}}")]
    [InlineData("{\"listings\":{},\"Listings\":{}}")]
    public void UnreadableOrAmbiguousMetadataCommitsBinaryThenFailsNotesPhase(string json)
    {
        var events = new List<string>();
        var failure = Assert.Throws<InvalidOperationException>(() => Publish(
            () => { events.Add("read"); return MsStoreSubmission.Parse(json); },
            _ => events.Add("update"), () => events.Add("commit")));
        Assert.Contains("binary submission publish command succeeded", failure.Message);
        Assert.Equal(new[] { "read", "commit" }, events);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void MetadataReadFailureNeverBecomesSuccessfulSkip(bool duringReadback)
    {
        var events = new List<string>();
        var reads = 0;
        Assert.Throws<InvalidOperationException>(() => Publish(() =>
        {
            events.Add("read");
            if (!duringReadback || ++reads > 1)
            {
                throw new IOException("metadata unavailable");
            }
            return MsStoreSubmission.Parse(Draft);
        }, _ => events.Add("update"), () => events.Add("commit")));
        Assert.Equal(duringReadback ? new[] { "read", "update", "read", "commit" }
            : new[] { "read", "commit" }, events);
    }

    [Fact]
    public void UpdateFailureCommitsBinaryOnceButCannotAdvanceSuccessfulNotesBaseline()
    {
        var events = new List<string>();
        Assert.Throws<InvalidOperationException>(() => Publish(
            () => { events.Add("read"); return MsStoreSubmission.Parse(Draft); },
            _ => { events.Add("update"); throw new InvalidOperationException("CLI exit 19"); },
            () => events.Add("commit")));
        Assert.Equal(new[] { "read", "update", "commit" }, events);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("not JSON")]
    [InlineData("{\"listings\":{\"he-il\":{\"baseListing\":{\"releaseNotes\":\"different\"}}}}")]
    [InlineData("{\"listings\":{\"he-il\":{\"baseListing\":{\"releaseNotes\":42}}}}")]
    public void MissingMalformedOrDifferentReadbackIsFailureAfterCommit(string readback)
    {
        var reads = 0;
        var commits = 0;
        var updates = 0;
        Assert.Throws<InvalidOperationException>(() => Publish(
            () => MsStoreSubmission.Parse(++reads == 1 ? Draft : readback),
            _ => updates++, () => commits++));
        Assert.Equal(1, updates);
        Assert.Equal(1, commits);
    }

    [Fact]
    public void OversizedMetadataCannotBeSentAndIsNotASkip()
    {
        var updates = 0;
        var commits = 0;
        Assert.Throws<InvalidOperationException>(() => Publish(() =>
        {
            var submission = MsStoreSubmission.Parse(Draft);
            submission["unrelated"] = new string('x', 30000);
            return submission;
        }, _ => updates++, () => commits++));
        Assert.Equal(0, updates);
        Assert.Equal(1, commits);
    }

    [Theory]
    [InlineData("releaseNotes")]
    [InlineData("ReleaseNotes")]
    public void ExactDraftReadbackPreservesOtherMetadataAndPropertyCasing(string notesKey)
    {
        var original = MsStoreSubmission.Parse("""
            {"id":"draft","untouched":[{"value":1}],"Listings":{"HE-il":{"BaseListing":{}},
            "en-us":{"baseListing":{"releaseNotes":"English remains"}}}}
            """);
        original["Listings"]!["HE-il"]!["BaseListing"]![notesKey] = "old";
        JsonObject? updated = null;
        var events = new List<string>();
        var applied = Publish(() =>
        {
            events.Add("read");
            return (JsonObject)(updated ?? original).DeepClone();
        }, metadata =>
        {
            events.Add("update");
            Assert.All(metadata, character => Assert.InRange((int)character, 0, 127));
            updated = MsStoreSubmission.Parse(metadata);
        }, () => events.Add("commit"));
        Assert.True(applied);
        Assert.Equal(new[] { "read", "update", "read", "commit" }, events);
        Assert.NotNull(updated);
        Assert.Equal("draft", updated["id"]!.GetValue<string>());
        Assert.True(JsonNode.DeepEquals(original["untouched"], updated["untouched"]));
        Assert.Equal("English remains", updated["Listings"]!["en-us"]!["baseListing"]!["releaseNotes"]!.GetValue<string>());
        var target = updated["Listings"]!["HE-il"]!["BaseListing"]!.AsObject();
        Assert.Single(target);
        Assert.Equal(Notes, target[notesKey]!.GetValue<string>());
    }

    [Fact]
    public void BinaryCommitFailureStillFailsEvenWhenNotesWereVerifiedAbsent()
    {
        var expected = new IOException("commit failed");
        var actual = Assert.Throws<IOException>(() => Publish(() => MsStoreSubmission.Parse("{}"),
            _ => Assert.Fail("No update is authorized"), () => throw expected));
        Assert.Same(expected, actual);
    }

    [Fact]
    public void ExistingHebrewBaseListingCanReceiveItsMissingNotesField()
    {
        var submission = MsStoreSubmission.Parse("""{"listings":{"he":{"baseListing":{}}}}""");
        var commits = 0;
        Assert.True(Publish(() => (JsonObject)submission.DeepClone(),
            metadata => submission = MsStoreSubmission.Parse(metadata), () => commits++));
        Assert.Equal(Notes, submission["listings"]!["he"]!["baseListing"]!["releaseNotes"]!.GetValue<string>());
        Assert.Equal(1, commits);
    }

    static bool Publish(Func<JsonObject> read, Action<string> update, Action commit) =>
        MsStoreSubmission.PublishWithReleaseNotes(read, update, commit, Notes, Log.Logger);
}
