namespace BibleOnSite.Helpers;

/// <summary>
/// Resolves links found inside Tanahpedia entry content. Entry HTML is
/// admin-authored against the website, so internal references point at
/// <c>/pedia/{uniqueName}</c> — the same canonical slug the app's entry route
/// uses. Links that do not match are external and open in the browser.
/// </summary>
public static class TanahpediaLinks
{
    /// <summary>The website path segment that carries an entry slug.</summary>
    private const string PediaSegment = "/pedia/";

    /// <summary>
    /// Extracts the entry <paramref name="uniqueName"/> from an in-content link:
    /// <c>/pedia/דתן</c>, <c>pedia/דתן</c>, or any absolute URL whose path
    /// carries a <c>/pedia/</c> segment (e.g. the website domain). Slugs arrive
    /// percent-encoded; the result is decoded and NFC-normalized like the
    /// website's route param handling.
    /// </summary>
    /// <returns>True when the link names an entry.</returns>
    public static bool TryGetEntryUniqueName(string? url, out string uniqueName)
    {
        uniqueName = string.Empty;
        if (string.IsNullOrWhiteSpace(url))
        {
            return false;
        }

        var trimmed = url.Trim();
        var index = trimmed.IndexOf(PediaSegment, StringComparison.OrdinalIgnoreCase);
        string slug;
        if (index >= 0)
        {
            slug = trimmed[(index + PediaSegment.Length)..];
        }
        else if (trimmed.StartsWith("pedia/", StringComparison.OrdinalIgnoreCase))
        {
            slug = trimmed["pedia/".Length..];
        }
        else
        {
            return false;
        }

        // Strip query/fragment — the slug ends there.
        var end = slug.IndexOfAny(['?', '#']);
        if (end >= 0)
        {
            slug = slug[..end];
        }

        if (slug.Length == 0)
        {
            return false;
        }

        try
        {
            slug = Uri.UnescapeDataString(slug);
        }
        catch (UriFormatException)
        {
            // Malformed escapes — use the raw segment as-is, like the website.
        }

        uniqueName = slug.Trim().Normalize();
        return uniqueName.Length > 0;
    }
}
