using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// E2E-only data source. iOS simulator builds never receive the perushim_notes
/// ODR pack, so the HtmlView commentary path (the NSHTMLReader crash surface of
/// TestFlight incidents F0AF3C74 and 351F87DB) cannot be exercised in CI.
/// When the app launches with BIBLE_E2E_PERUSHIM=1 — set by the mobile e2e
/// suite through Appium processArguments — this provider fabricates realistic
/// perushim notes so pasuk cells render HtmlView exactly like a device with
/// the notes pack installed. Production launches never set the variable.
/// </summary>
internal static class SyntheticPerushimProvider
{
    private const string EnableVariable = "BIBLE_E2E_PERUSHIM";

    public static bool Enabled =>
        string.Equals(Environment.GetEnvironmentVariable(EnableVariable), "1",
            StringComparison.Ordinal);

    /// <summary>Synthetic commentaries: negative ids cannot collide with the real catalog.</summary>
    public static List<Perush> Perushim =>
    [
        new() { Id = -1, Name = "מפרש א׳", Priority = 0 },
        new() { Id = -2, Name = "מפרש ב׳", Priority = 1 },
        new() { Id = -3, Name = "מפרש ג׳", Priority = 2 },
    ];

    /// <summary>
    /// A note per synthetic perush for every pasuk — dense enough that each
    /// recycled pasuk cell renders several HtmlView instances during scroll.
    /// The markup mirrors real Sefaria note content (b/i/sup/small/br, empty
    /// commentator markers, entities) so the same conversion paths run.
    /// </summary>
    public static List<PerekPerushNote> NotesFor(int perekId, IEnumerable<int> pasukNums)
    {
        var notes = new List<PerekPerushNote>();
        foreach (var pasuk in pasukNums)
        {
            var index = 0;
            foreach (var perush in Perushim)
            {
                notes.Add(new PerekPerushNote
                {
                    PerushId = perush.Id,
                    PerushName = perush.Name,
                    PerekId = perekId,
                    Pasuk = pasuk,
                    NoteIdx = index++,
                    NoteContent =
                        $"<b>פסוק {pasuk}</b> פירוש {perush.Name} על המילים " +
                        "כאן<i data-commentator=\"Synthetic\" data-order=\"1\"></i> " +
                        "ועיין <sup>במקור</sup> נוסף<br>שורה שנייה " +
                        "<small>בכתב קטן</small> עם &lt;סוגריים&gt; ועוד טקסט ארוך " +
                        "שממשיך וממלא את התא כדי שהרינדור יהיה ריאליסטי בגודלו."
                });
            }
        }
        return notes;
    }
}
