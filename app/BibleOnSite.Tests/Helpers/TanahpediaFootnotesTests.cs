using System.Text.RegularExpressions;
using BibleOnSite.Helpers;
using HtmlAgilityPack;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Regression coverage for <see cref="TanahpediaFootnotes.Normalize"/> and the
/// <see cref="HtmlRuns"/> footnote marker (#2639). The fixtures mirror the
/// markup generations stored in production (trimmed verbatim from יהושע בן נון
/// and משה רבנו).
/// </summary>
public sealed class TanahpediaFootnotesTests
{
    private const string LegacySupList = @"
<p>גדול היה<a href=""#x"">קישור</a> ואחריו<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup>.</p>
<hr>
<h2>הערות</h2>
<ol style=""list-style:none;padding:0;"">
<li id=""note-1""><sup>א</sup> שמות ב י <a href=""#noteref-1"">↩</a></li>
<li id=""note-2""><sup>ב</sup> חזקוני שמות ב י <a href=""#noteref-2"">↩</a></li>
</ol>";

    private const string LegacyBare = @"
<p>ומדבר עמו כאדם המדבר עם חברו<a href=""#note-54"" data-link-type=""comment"">נד</a>.</p>
<p>עוד דבר<a href=""#note-1"" data-link-type=""comment"">א</a>.</p>
<hr>
<h2>הערות</h2>
<ol>
<li><p>א שמות ב י <a href=""#noteref-1"" data-link-type=""comment"">↩</a></p></li>
<li><p>נד מדרש הגדול שמות ב י <a href=""#noteref-54"" data-link-type=""comment"">↩</a></p></li>
</ol>";

    private const string LegacyParagraphs = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<h2>הערות</h2>
<p id=""note-1""><strong>א.</strong> גופה של הערה</p>";

    private const string Canonical = @"
<p>טקסט<sup id=""fnref:1""><a class=""footnote-ref"" data-id=""u1"" data-reference-number=""1"" href=""#fn:1"" role=""doc-noteref"">א</a></sup></p>
<ol class=""footnotes""><li id=""fn:1"" data-id=""u1""><p>גופה של הערה<a class=""footnote-backref"" href=""#fnref:1"" role=""doc-backlink"" aria-label=""חזרה לאזכור א"">↩</a></p></li></ol>";

    private static HtmlNode Parse(string html)
    {
        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        return doc.DocumentNode;
    }

    [Fact]
    public void Normalize_LeavesContentWithoutFootnotesUnchanged()
    {
        const string html = "<p>טקסט רגיל</p><ol><li>אחד</li><li>שניים</li></ol>";
        Assert.Equal(html, TanahpediaFootnotes.Normalize(html));
        Assert.Null(TanahpediaFootnotes.Normalize(null));
    }

    [Fact]
    public void Normalize_CanonicalizesLiteralSupList()
    {
        var root = Parse(TanahpediaFootnotes.Normalize(LegacySupList)!);
        var list = root.SelectSingleNode(".//ol[contains(@class,'footnotes')]");
        Assert.NotNull(list);
        var items = list!.SelectNodes("./li");
        Assert.Equal(2, items!.Count);
        Assert.Equal("fn:1", items[0].GetAttributeValue("id", ""));
        Assert.Equal("fn:2", items[1].GetAttributeValue("id", ""));
        /* The marker travels in data-marker so the renderer shows the note's
           own number. */
        Assert.Equal("א", items[0].GetAttributeValue("data-marker", ""));
        Assert.Equal("ב", items[1].GetAttributeValue("data-marker", ""));
        /* The literal marker is gone — the single visible marker is generated. */
        Assert.Null(items[0].SelectSingleNode(".//sup"));
        Assert.StartsWith("שמות", HtmlEntity.DeEntitize(items[0].InnerText).Trim());

        var noteRef = root.SelectSingleNode(".//sup[@id='fnref:1']/a[contains(@class,'footnote-ref')]");
        Assert.NotNull(noteRef);
        Assert.Equal("#fn:1", noteRef!.GetAttributeValue("href", ""));
        Assert.Equal("doc-noteref", noteRef.GetAttributeValue("role", ""));

        var back = items[0].SelectSingleNode(".//a[contains(@class,'footnote-backref')]");
        Assert.Equal("#fnref:1", back?.GetAttributeValue("href", ""));
        Assert.Equal("doc-backlink", back?.GetAttributeValue("role", ""));
    }

    [Fact]
    public void Normalize_CanonicalizesBareAnchorGeneration()
    {
        var root = Parse(TanahpediaFootnotes.Normalize(LegacyBare)!);
        var ref54 = root.SelectSingleNode(".//a[@href='#fn:54']");
        Assert.NotNull(ref54);
        Assert.Equal("sup", ref54!.ParentNode!.Name);
        Assert.Equal("fnref:54", ref54.ParentNode!.GetAttributeValue("id", ""));
        Assert.Equal("doc-noteref", ref54.GetAttributeValue("role", ""));
        Assert.Equal("נד", HtmlEntity.DeEntitize(ref54.InnerText));

        /* The body gets an fn id even though the stored li had none, and the
           inline letter is stripped — the renderer supplies the marker. */
        var note54 = root.SelectSingleNode(".//*[@id='fn:54']");
        Assert.NotNull(note54);
        Assert.Equal("נד", note54!.GetAttributeValue("data-marker", ""));
        Assert.StartsWith("מדרש", HtmlEntity.DeEntitize(note54.InnerText).Trim());
        var back = note54.SelectSingleNode(".//a[contains(@class,'footnote-backref')]");
        Assert.Equal("#fnref:54", back?.GetAttributeValue("href", ""));
        /* The legacy wrapper list is gone — the canonical list replaces it
           wholesale instead of nesting inside a leftover li. */
        var list = Assert.Single(root.SelectNodes(".//ol")!);
        Assert.Equal("footnotes", list.GetAttributeValue("class", ""));
        Assert.Same(list, note54.ParentNode);
    }

    [Fact]
    public void Normalize_CanonicalizesParagraphBodies()
    {
        var root = Parse(TanahpediaFootnotes.Normalize(LegacyParagraphs)!);
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("fn:1", item.GetAttributeValue("id", ""));
        Assert.Null(item.SelectSingleNode(".//strong"));
        Assert.StartsWith("גופה", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_IsIdempotentOnCanonicalMarkup()
    {
        var once = TanahpediaFootnotes.Normalize(Canonical)!;
        var twice = TanahpediaFootnotes.Normalize(once)!;
        var root = Parse(twice);
        Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.NotNull(root.SelectSingleNode(".//sup[@id='fnref:1']/a[contains(@class,'footnote-ref')]"));
        Assert.Equal(
            "#fnref:1",
            root.SelectSingleNode(".//ol[contains(@class,'footnotes')]//a[contains(@class,'footnote-backref')]")?.GetAttributeValue("href", ""));
        var li = root.SelectSingleNode(".//ol[contains(@class,'footnotes')]/li")!;
        Assert.StartsWith("גופה", HtmlEntity.DeEntitize(li.InnerText).Trim());
    }

    [Fact]
    public void Normalize_MapsRepeatedReferencesToOneNoteWithUniqueRefIds()
    {
        const string html = @"
<p>אחד<sup><a href=""#note-1"" id=""noteref-1a"">א</a></sup> ושוב<sup><a href=""#note-1"" id=""noteref-1b"">א</a></sup></p>
<ol style=""list-style:none""><li id=""note-1""><sup>א</sup> הערה <a href=""#noteref-1a"">↩</a></li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var refIds = root.SelectNodes(".//sup[@id]")!.Select(n => n.GetAttributeValue("id", "")).ToList();
        Assert.Equal(2, refIds.Distinct().Count());
        Assert.Equal(2, root.SelectNodes(".//a[@href='#fn:1']")!.Count);
        var back = root.SelectSingleNode(".//ol[contains(@class,'footnotes')]//a[contains(@class,'footnote-backref')]");
        Assert.Contains(back!.GetAttributeValue("href", "")[1..], refIds);
    }

    [Fact]
    public void Normalize_PreservesOrdinaryListsAndProseStartingWithHebrewLetter()
    {
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol><li>אחת שתיים שלוש</li><li>עוד פריט</li></ol>
<ol style=""list-style:none""><li id=""note-1""><sup>א</sup> אוהב את התורה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        Assert.Equal(2, root.SelectNodes(".//ol")!.Count);
        var ordinary = root.SelectSingleNode(".//ol[not(contains(@class,'footnotes'))]");
        Assert.Equal(2, ordinary!.SelectNodes("./li")!.Count);
        var note = root.SelectSingleNode(".//*[@id='fn:1']");
        /* 'אוהב' is prose, not the marker 'א' — only the sup letter is stripped. */
        Assert.StartsWith("אוהב", HtmlEntity.DeEntitize(note!.InnerText).Trim());
    }

    [Fact]
    public void Normalize_CarriesTheNotesOwnNumberInDataMarkerForSparseNumbering()
    {
        /* A lone note 54 must display נד — not its list position א. */
        const string html = @"<p>טקסט<a href=""#note-54"">נד</a></p>
<ol><li><p>נד מדרש הגדול <a href=""#noteref-54"">↩</a></p></li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = root.SelectSingleNode(".//ol[contains(@class,'footnotes')]/li");
        Assert.Equal("fn:54", item?.GetAttributeValue("id", ""));
        Assert.Equal("נד", item?.GetAttributeValue("data-marker", ""));
    }

    [Fact]
    public void Normalize_RetargetsCrossNoteReferencesToCanonicalIds()
    {
        /* A #note-N link inside a note body is a note-to-note cross-reference,
           not an inline reference - it must not become a sup/fnref, but its
           legacy target id is renamed to fn:N like every other id so the
           link keeps resolving. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol style=""list-style:none"">
<li id=""note-1""><sup>א</sup> ראו <a href=""#note-2"">הערה ב</a></li>
<li id=""note-2""><sup>ב</sup> חזקוני</li>
</ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        Assert.NotNull(root.SelectSingleNode(".//*[@id='fn:2']"));
        var note1 = Assert.Single(root.SelectNodes(".//*[@id='fn:1']")!);
        var cross = Assert.Single(note1.SelectNodes(".//a")!
            .Where(a => a.GetAttributeValue("href", "") == "#fn:2"));
        Assert.DoesNotContain("footnote-ref", cross.GetAttributeValue("class", ""));
        Assert.Equal("li", cross.ParentNode!.Name);
    }

    [Fact]
    public void Normalize_FillsMissingRefLabelWithTheHebrewMarker()
    {
        /* A stripped/empty anchor label must never render as an invisible
           link - the note's own marker is re-emitted as the label. */
        const string html = @"
<p>טקסט<sup><a href=""#note-2"" id=""noteref-2""></a></sup></p>
<ol style=""list-style:none""><li id=""note-2""><sup>ב</sup> הערה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var anchor = Assert.Single(root.SelectNodes(".//sup[@id='fnref:2']/a")!);
        Assert.Equal("ב", HtmlEntity.DeEntitize(anchor.InnerText));
    }

    [Fact]
    public void Normalize_LeavesFootnotesListWithoutNoteIdsUntouched()
    {
        /* ol.footnotes with no fn:/note- ids carries no rewritable structure -
           the items stay as authored instead of being renumbered. */
        const string html = @"<ol class=""footnotes""><li>טקסט בלי מזהה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("", item.GetAttributeValue("id", ""));
        Assert.Equal("", item.GetAttributeValue("data-marker", ""));
    }

    [Fact]
    public void FromHtml_FootnoteListGetsSingleHebrewMarkerPerNote()
    {
        var normalized = TanahpediaFootnotes.Normalize(LegacySupList)!;
        var runs = HtmlRuns.FromHtml(normalized);
        var text = string.Concat(runs.Select(r => r.Text));
        /* One generated Hebrew marker per note — no decimal and no literal
           duplicate: 'א שמות' then 'ב חזקוני', never '1. א' or '2. ב'. */
        Assert.Contains("א שמות ב י", text);
        Assert.Contains("ב חזקוני שמות ב י", text);
        Assert.DoesNotContain("1. א", text);
        Assert.DoesNotContain("2. ב", text);
    }

    [Fact]
    public void FromHtml_MultiLetterMarkersRenderForHighNumbers()
    {
        const string html = @"
<ol><li><p>נד מדרש הגדול <a href=""#noteref-54"">↩</a></p></li></ol>
<p>טקסט<a href=""#note-54"">נד</a></p>";
        var normalized = TanahpediaFootnotes.Normalize(html)!;
        /* The li keeps its canonical <p> wrapper, so the note text follows the
           marker on its own line — collapse whitespace to compare content. */
        var text = Regex.Replace(
            string.Concat(HtmlRuns.FromHtml(normalized).Select(r => r.Text)),
            @"\s+", " ");
        Assert.Contains("נד מדרש הגדול", text);
        Assert.DoesNotContain("1. נד", text);
    }
}
