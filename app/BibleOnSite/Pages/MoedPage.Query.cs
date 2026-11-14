namespace BibleOnSite.Pages;

// This part owns the Shell URI query boundary independently of XAML setup.
// Partial is required by the XAML page and this separately testable query boundary.
#pragma warning disable S2333
public partial class MoedPage : IQueryAttributable
#pragma warning restore S2333
{
    // Slug requested via query attributes before the initial load finished —
    // the canonical deep-link key (list taps and /moadim/{slug} links).
    private string? _pendingSlug;

    // Id requested via query attributes; resolved through the loaded catalogue.
    private int? _pendingId;

    /// <summary>
    /// Query attributes for deep navigation: <c>?slug=תשעה-באב</c> opens a moed
    /// by its canonical slug; <c>?id=3</c> resolves through the catalogue.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("slug", out var slugValue))
        {
            _pendingSlug = slugValue is string slug ? Uri.UnescapeDataString(slug) : null;
            _pendingId = null;
        }
        else if (query.TryGetValue("id", out var idValue))
        {
            _pendingId = ParsePositiveInt(idValue);
            _pendingSlug = null;
        }
    }

    private static int? ParsePositiveInt(object value) => value switch
    {
        int i when i > 0 => i,
        string s when int.TryParse(s, out var parsed) && parsed > 0 => parsed,
        _ => null
    };
}
