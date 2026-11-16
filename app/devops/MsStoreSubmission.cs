using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Nodes;
using Nuke.Common.Tooling;
using Serilog;

/// <summary>Read machine output separately from diagnostics and verify draft-local release notes.</summary>
internal static class MsStoreSubmission
{
    internal static JsonObject Read(string executable, string arguments)
    {
        var process = ProcessTasks.StartProcess(executable, arguments,
            logOutput: false, logInvocation: true);
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"msstore could not read the pending submission (exit {process.ExitCode})");
        }
        var stdout = string.Join("\n", process.Output
            .Where(line => line.Type == OutputType.Std).Select(line => line.Text));
        return Parse(stdout);
    }

    internal static JsonObject Parse(string stdout)
    {
        using var document = JsonDocument.Parse(stdout);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidOperationException("Pending submission JSON must be an object");
        }
        ValidateProperties(document.RootElement);
        return (JsonObject)JsonNode.Parse(stdout)!;
    }

    // Partner Center casing varies; duplicate names must not select an arbitrary
    // value when the complete metadata object is sent back to the same draft.
    static void ValidateProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new InvalidOperationException("Pending submission has ambiguous property names");
                }
                ValidateProperties(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                ValidateProperties(item);
            }
        }
    }

    /// <summary>Commit the binary once, then fail the phase if notes could not be verified.</summary>
    internal static bool PublishWithReleaseNotes(Func<JsonObject> readSubmission,
        Action<string> updateSubmission, Action publishSubmission, string notes, ILogger logger)
    {
        var outcome = SetReleaseNotes(readSubmission, updateSubmission, notes, logger);
        publishSubmission();
        if (outcome == NotesOutcome.Failed)
        {
            throw new InvalidOperationException(
                "Hebrew releaseNotes could not be verified; the binary submission publish command succeeded");
        }
        return outcome == NotesOutcome.Applied;
    }

    enum NotesOutcome { Applied, VerifiedAbsent, Failed }

    static NotesOutcome SetReleaseNotes(Func<JsonObject> readSubmission,
        Action<string> updateSubmission, string notes, ILogger logger)
    {
        try
        {
            var submission = readSubmission();
            var target = FindHebrewBaseListing(submission);
            if (target is null)
            {
                logger.Warning("Pending submission has no editable Hebrew listing; skipping draft-local release notes");
                return NotesOutcome.VerifiedAbsent;
            }
            var (hebrewKey, baseListing) = target.Value;
            var releaseNotes = Property(baseListing, "releaseNotes");
            if (releaseNotes.Value is not null)
            {
                _ = releaseNotes.Value.GetValue<string>();
            }
            baseListing[releaseNotes.Key ?? "releaseNotes"] = notes;
            // Default JSON escaping keeps Hebrew ASCII-safe in the CLI argument.
            var metadata = submission.ToJsonString();
            const int argLimit = 30000;
            if (metadata.Length > argLimit)
            {
                throw new InvalidOperationException(
                    $"Submission metadata is {metadata.Length} chars, over the safe CLI argument size");
            }
            updateSubmission(metadata);
            var persisted = Property(readSubmission(), "listings").Value;
            var accepted = persisted is JsonObject currentListings
                && Property(currentListings, hebrewKey).Value is JsonObject currentHebrew
                && Property(currentHebrew, "baseListing").Value is JsonObject currentBase
                && Property(currentBase, "releaseNotes").Value?.GetValue<string>() == notes;
            if (!accepted)
            {
                throw new InvalidOperationException("Partner Center did not persist the exact Hebrew releaseNotes");
            }
            return NotesOutcome.Applied;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException
            or ArgumentException or IOException or NotSupportedException or ProcessException or Win32Exception)
        {
            logger.Warning("Hebrew releaseNotes verification failed: {Reason}", error.Message);
            return NotesOutcome.Failed;
        }
    }

    static (string Key, JsonObject BaseListing)? FindHebrewBaseListing(JsonObject submission)
    {
        var listingsNode = Property(submission, "listings").Value;
        if (listingsNode is null)
        {
            return null;
        }
        if (listingsNode is not JsonObject listings)
        {
            throw new InvalidOperationException("Pending submission listings must be an object");
        }
        var hebrewKeys = listings.Select(property => property.Key)
            .Where(key => key.Equals("he", StringComparison.OrdinalIgnoreCase)
                || key.StartsWith("he-", StringComparison.OrdinalIgnoreCase)).ToArray();
        if (hebrewKeys.Length == 0)
        {
            return null;
        }
        if (hebrewKeys.Length != 1)
        {
            throw new InvalidOperationException("Pending submission has multiple Hebrew listings");
        }
        var key = hebrewKeys[0];
        if (listings[key] is not JsonObject hebrewListing)
        {
            throw new InvalidOperationException("Pending Hebrew listing must be an object");
        }
        var baseListing = Property(hebrewListing, "baseListing").Value;
        if (baseListing is null)
        {
            return null;
        }
        if (baseListing is not JsonObject value)
        {
            throw new InvalidOperationException("Pending Hebrew baseListing must be an object");
        }
        return (key, value);
    }

    static KeyValuePair<string, JsonNode?> Property(JsonObject value, string name)
    {
        var matches = value.Where(property => property.Key.Equals(name,
            StringComparison.OrdinalIgnoreCase)).ToArray();
        if (matches.Length > 1)
        {
            throw new InvalidOperationException("Pending submission has ambiguous property names");
        }
        return matches.FirstOrDefault();
    }
}
