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
    public void Normalize_BackrefFallsBackToCanonicalFnrefIdWhenNoteHasNoInlineRef()
    {
        /* A note with no inline reference still gets a stable backref target:
           the canonical fnref:N rather than a dangling generated id. */
        const string html = @"
<p>טקסט בלי אזכורים</p>
<ol style=""list-style:none""><li id=""note-3""><sup>ג</sup> הערה יתומה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:3']")!);
        var back = Assert.Single(item.SelectNodes(".//a[contains(@class,'footnote-backref')]")!);
        Assert.Equal("#fnref:3", back.GetAttributeValue("href", ""));
    }

    [Fact]
    public void Normalize_ProcessesABodyOnceWhenReachableUnderTwoNumbers()
    {
        /* An li carrying id="note-1" AND a "#noteref-2" backlink registers
           under both numbers but canonicalizes once - one fn:1 item, no fn:2. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol style=""list-style:none""><li id=""note-1""><sup>א</sup> טקסט <a href=""#noteref-2"">↩</a></li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var items = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("fn:1", items.GetAttributeValue("id", ""));
        /* SelectNodes returns null (not an empty collection) for zero matches. */
        Assert.Empty(root.SelectNodes(".//*[@id='fn:2']") ?? Enumerable.Empty<HtmlNode>());
        Assert.Single(items.SelectNodes(".//a[contains(@class,'footnote-backref')]")!);
    }

    [Fact]
    public void Normalize_KeepsLeadingElementThatIsNotTheMarker()
    {
        /* A leading <sup> whose text is not this note's marker is real content -
           only an exact marker match is stripped. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol style=""list-style:none""><li id=""note-1""><sup>כתוב</sup> הערה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:1']")!);
        var sup = Assert.Single(item.SelectNodes(".//sup")!);
        Assert.Equal("כתוב", HtmlEntity.DeEntitize(sup.InnerText));
    }

    [Fact]
    public void Normalize_AppendsBackrefToItemWhenBodyHasNoElementChildren()
    {
        /* Text-only note bodies still receive the jump-back link - it attaches
           to the li itself when there is no inner element to host it. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol style=""list-style:none""><li id=""note-1"">טקסט בלבד בלי אלמנטים</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:1']")!);
        var back = Assert.Single(item.SelectNodes("./a[contains(@class,'footnote-backref')]")!);
        Assert.Equal("#fnref:1", back.GetAttributeValue("href", ""));
        Assert.StartsWith("טקסט בלבד", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_LeavesNonNumericNoteMarkupUnchanged()
    {
        /* AnyMarker can hit ids/hrefs that carry no number (id="note-x") —
           with no numeric body, ref, or canonical list there is nothing to
           normalize and the markup passes through. */
        const string html = @"<p id=""note-x"">כותרת</p><p><a href=""#note-x"">קישור</a> <a href=""#noteref-x"">↩</a></p>";
        Assert.Equal(html, TanahpediaFootnotes.Normalize(html));
    }

    [Fact]
    public void Normalize_AnchorsCanonicalListWhereALooseItemLived()
    {
        /* A stored li note outside any ol/ul still gets a canonical list —
           anchored at the item's position inside its container. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<div class=""notes""><li id=""note-1""><sup>א</sup> הערה מחוץ לרשימה</li></div>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//div[@class='notes']/ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("fn:1", item.GetAttributeValue("id", ""));
        Assert.StartsWith("הערה מחוץ", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_ReplacesWrappingListForParagraphBody()
    {
        /* A paragraph note nested directly in a list: the canonical list takes
           the wrapper's place instead of leaving an emptied shell. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol><p id=""note-1""><strong>א.</strong> הערה בפסקה</p></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("fn:1", item.GetAttributeValue("id", ""));
        Assert.Null(item.SelectSingleNode(".//strong"));
        Assert.StartsWith("הערה בפסקה", HtmlEntity.DeEntitize(item.InnerText).Trim());
        Assert.Empty(root.SelectNodes(".//ol[not(contains(@class,'footnotes'))]") ?? Enumerable.Empty<HtmlNode>());
    }

    [Fact]
    public void Normalize_IgnoresNoteIdsAndRefsWithoutUsableNumberOrBody()
    {
        /* Loose elements: a note-id on an element outside any li/p has no
           body to canonicalize; note-0 and overflowing numbers are not
           footnotes at all. The real note still normalizes. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup> <a href=""#note-0"">אפס</a> <a href=""#note-999999999999"">גלישה</a></p>
<a id=""note-9"">עוגן יתום</a><span id=""note-0"">אפס</span><p id=""note-999999999999"">גלישה</p>
<ol style=""list-style:none""><li id=""note-1""><sup>א</sup> הערה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("fn:1", item.GetAttributeValue("id", ""));
        Assert.NotNull(root.SelectSingleNode(".//a[@id='note-9']"));
        Assert.Equal("#note-0", root.SelectSingleNode(".//a[text()='אפס']")?.GetAttributeValue("href", ""));
    }

    [Fact]
    public void Normalize_KeepsBodyOpeningWithANonMarkerElement()
    {
        /* A body that opens with a non-marker element (<em>) is prose — the
           marker stripper stops at it instead of eating real content. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup></p>
<ol style=""list-style:none""><li id=""note-1""><em>אמר</em> המדרש כך</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:1']")!);
        var em = Assert.Single(item.SelectNodes(".//em")!);
        Assert.Equal("אמר", HtmlEntity.DeEntitize(em.InnerText));
    }

    [Fact]
    public void Normalize_StripsOnlyTheNotesOwnLiteralMarker()
    {
        /* <b> is a marker wrapper like <strong>/<sup>; a bare-text marker with
           a trailing dot strips too. Wrong-letter or non-Hebrew openings are
           prose and stay. */
        const string html = @"
<p>טקסט<sup><a href=""#note-1"" id=""noteref-1"">א</a></sup><sup><a href=""#note-2"" id=""noteref-2"">ב</a></sup><sup><a href=""#note-3"" id=""noteref-3"">ג</a></sup><sup><a href=""#note-4"" id=""noteref-4"">ד</a></sup></p>
<ol style=""list-style:none"">
<li id=""note-1""><b>א.</b> ראשונה</li>
<li id=""note-2"">ב. שנייה</li>
<li id=""note-3"">ז שלישית באות אחרת</li>
<li id=""note-4"">Source: cited</li>
</ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var items = root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!;
        Assert.Equal(4, items.Count);
        Assert.StartsWith("ראשונה", HtmlEntity.DeEntitize(items[0].InnerText).Trim());
        Assert.StartsWith("שנייה", HtmlEntity.DeEntitize(items[1].InnerText).Trim());
        Assert.StartsWith("ז שלישית", HtmlEntity.DeEntitize(items[2].InnerText).Trim());
        Assert.StartsWith("Source", HtmlEntity.DeEntitize(items[3].InnerText).Trim());
        Assert.Empty(items.SelectMany(i => i.SelectNodes(".//b") ?? Enumerable.Empty<HtmlNode>()));
    }

    [Fact]
    public void Normalize_RetargetsNoteLinkWhenFootnoteListHasNoMatchingBody()
    {
        /* A #note-N anchor next to an id-less ol.footnotes is a dangling ref —
           it is still canonicalized to #fn:N rather than becoming a ref. */
        const string html = @"
<ol class=""footnotes""><li>בלי מזהה</li></ol>
<p><a href=""#note-7"">ז</a></p>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        Assert.Equal("#fn:7", root.SelectSingleNode(".//p/a")?.GetAttributeValue("href", ""));
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Equal("", item.GetAttributeValue("id", ""));
    }

    [Fact]
    public void Normalize_KeepsFirstBodyWhenANoteIdRepeats()
    {
        /* The first element bearing a note id owns the number — a duplicate id
           does not displace it. */
        const string html = @"
<p>טקסט<a href=""#note-1"">א</a></p>
<p id=""note-1"">גוף ראשון</p>
<li id=""note-1"">גוף שני</li>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//ol[contains(@class,'footnotes')]/li")!);
        Assert.Contains("גוף ראשון", HtmlEntity.DeEntitize(item.InnerText));
    }

    [Fact]
    public void Normalize_ResolvesBodyThroughParagraphAncestor()
    {
        /* A bare #noteref link inside a paragraph resolves the paragraph as
           the note body — same precedence as the website's closest("p"). */
        const string html = @"
<p>טקסט<a href=""#note-1"">א</a></p>
<p><a href=""#noteref-1"">↩</a> גוף ההערה</p>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:1']")!);
        Assert.Equal("li", item.Name);
        Assert.Contains("גוף ההערה", HtmlEntity.DeEntitize(item.InnerText));
        var back = Assert.Single(item.SelectNodes(".//a[contains(@class,'footnote-backref')]")!);
        Assert.Equal("#fnref:1", back.GetAttributeValue("href", ""));
    }

    [Fact]
    public void FromHtml_FallsBackToPositionMarkerWhenDataMarkerIsMissing()
    {
        /* Canonical lists authored without data-marker still get one marker
           per note — the gematria of the item's position. */
        var runs = HtmlRuns.FromHtml("<ol class=\"footnotes\"><li>הערה אחת</li><li>הערה שתיים</li></ol>");
        var text = string.Concat(runs.Select(r => r.Text));
        Assert.Contains("א הערה אחת", text);
        Assert.Contains("ב הערה שתיים", text);
        Assert.DoesNotContain("1. ", text);
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
    public void FromHtml_FootnoteMarkerSharesTheInlineReferenceStyle()
    {
        /* #2723: the generated note-list letter resolves to the same style the
           inline reference sup carries — raised baseline, compact scale and
           the accent color a link paints with — without a link target. */
        var runs = HtmlRuns.FromHtml(TanahpediaFootnotes.Normalize(LegacySupList)!);
        var markers = runs.Where(r => r.Accent).ToList();
        Assert.Equal(new[] { "א ", "ב " }, markers.Select(r => r.Text).ToArray());
        var reference = Assert.Single(runs, r => r.Link == "#fn:1");
        foreach (var marker in markers)
        {
            Assert.Equal(reference.BaselineShift, marker.BaselineShift);
            Assert.Equal(reference.FontScale, marker.FontScale);
            Assert.True(marker.BaselineShift > 0);
            Assert.True(marker.FontScale < 1.0);
            /* The marker is not a link — only the color matches. */
            Assert.Null(marker.Link);
        }

        /* Only the generated letter is styled — the note prose keeps the
           body style. */
        var prose = runs.Where(r => r.Text.Contains("שמות")).ToList();
        Assert.Equal(2, prose.Count);
        Assert.All(prose, run =>
        {
            Assert.False(run.Accent);
            Assert.Equal(0, run.BaselineShift);
            Assert.Equal(1.0, run.FontScale);
        });
    }

    [Fact]
    public void FromHtml_FootnoteMarkerSharesTheFirstLineWithALeadingParagraph()
    {
        /* #2723: canonical notes wrap their text in <p> — the marker must
           label the note's first line (the website inlines li > p:first-child),
           not float on a line of its own. */
        var runs = HtmlRuns.FromHtml(
            @"<ol class=""footnotes""><li id=""fn:1"" data-marker=""א""><p>גוף ההערה</p></li></ol>");
        var text = string.Concat(runs.Select(r => r.Text));
        Assert.Contains("א גוף ההערה", text);
        /* A paragraph further down still breaks onto its own line. */
        var multi = HtmlRuns.FromHtml(
            @"<ol class=""footnotes""><li id=""fn:1"" data-marker=""א""><p>ראשונה</p><p>שנייה</p></li></ol>");
        Assert.Contains("ראשונה\nשנייה", string.Concat(multi.Select(r => r.Text)));
    }

    [Fact]
    public void FromHtml_LeadParagraphKeepsItsOrderAfterLooseText()
    {
        /* Loose text before the note's first paragraph must stay ahead of it —
           the lead <p> flows inline at its own position, never ahead of
           earlier siblings. */
        var runs = HtmlRuns.FromHtml(
            @"<ol class=""footnotes""><li id=""fn:1"" data-marker=""א"">פתיח<p>המשך</p></li></ol>");
        var text = string.Concat(runs.Select(r => r.Text));
        var open = text.IndexOf("פתיח", StringComparison.Ordinal);
        var cont = text.IndexOf("המשך", StringComparison.Ordinal);
        Assert.True(open >= 0 && cont > open, $"expected opening text before the paragraph, got: {text}");
    }

    [Fact]
    public void FromHtml_LeadParagraphKeepsItsInlineStyle()
    {
        /* The leading paragraph's own attributes still reach its text — the
           inline flow suppresses only its block break. */
        var runs = HtmlRuns.FromHtml(
            @"<ol class=""footnotes""><li id=""fn:1"" data-marker=""א""><p style=""font-weight:bold"">הערה מודגשת</p></li></ol>");
        var run = Assert.Single(runs, r => r.Text.Contains("הערה מודגשת"));
        Assert.True(run.Bold);
    }

    [Fact]
    public void FromHtml_OrdinaryOrderedListMarkersStayPlain()
    {
        /* Only ol.footnotes markers take the accent/sup treatment — a regular
           <ol> keeps its decimal marker at body size and color (#2723). */
        var runs = HtmlRuns.FromHtml("<ol><li>אחד</li><li>שניים</li></ol>");
        var run = Assert.Single(runs, r => r.Text.Contains("1."));
        Assert.False(run.Accent);
        Assert.Equal(0, run.BaselineShift);
        Assert.Equal(1.0, run.FontScale);
        Assert.DoesNotContain(runs, r => r.Accent);
    }

    [Fact]
    public void FromHtml_MultiLetterMarkersRenderForHighNumbers()
    {
        const string html = @"
<ol><li><p>נד מדרש הגדול <a href=""#noteref-54"">↩</a></p></li></ol>
<p>טקסט<a href=""#note-54"">נד</a></p>";
        var normalized = TanahpediaFootnotes.Normalize(html)!;
        /* The li keeps its canonical <p> wrapper; the leading paragraph flows
           inline so the marker shares the note's first line — collapse
           whitespace to compare content. */
        var text = Regex.Replace(
            string.Concat(HtmlRuns.FromHtml(normalized).Select(r => r.Text)),
            @"\s+", " ");
        Assert.Contains("נד מדרש הגדול", text);
        Assert.DoesNotContain("1. נד", text);
    }

    [Fact]
    public void Normalize_LeavesMarkerLikeTextWithoutStructureUnchanged()
    {
        /* The AnyMarker pre-pass matches on text alone ("#note-", id="note-").
           Malformed ids, non-positive/overflowing numbers, and ids on elements
           that cannot hold a body (no li/p ancestor) must not trigger a
           rewrite — the input returns byte-identical. */
        const string html = @"<p>ראה <a href=""#note-x"">אזכור</a> <a href=""#note-0"">אפס</a> <a href=""#note-7"">ז</a> <a href=""#note-99999999999"">עודף</a> <a href=""#noteref-99999999999"">עודף</a></p>
<div id=""note-"">x</div><span id=""note-abc"">y</span><li id=""note-0"">אפס</li><li id=""note-99999999999"">עודף</li>";
        Assert.Equal(html, TanahpediaFootnotes.Normalize(html));
    }

    [Fact]
    public void Normalize_AnchorsTheCanonicalListWhereAnUnorderedListStood()
    {
        /* A legacy <ul> anchors the same way as <ol>: the canonical list is
           inserted at the container's position, then the emptied wrapper drops. */
        const string html = @"<p>טקסט<sup><a href=""#note-2"" id=""noteref-2"">ב</a></sup></p>
<ul><li id=""note-2""><sup>ב</sup> הערה</li></ul>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var list = Assert.Single(root.SelectNodes(".//ol | .//ul")!);
        Assert.Equal("footnotes", list.GetAttributeValue("class", ""));
        Assert.Equal("fn:2", Assert.Single(list.SelectNodes("./li")!).GetAttributeValue("id", ""));
    }

    [Fact]
    public void Normalize_AnchorsAtTheListWhenAParagraphBodySitsInsideOne()
    {
        /* A <p> body nested directly in a list container: the canonical list
           replaces the container wholesale (same rule as li bodies), not at
           the paragraph's inner position. */
        const string html = @"<p>טקסט<sup><a href=""#note-3"" id=""noteref-3"">ג</a></sup></p>
<ul><p id=""note-3""><strong>ג.</strong> גוף ההערה</p></ul>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var list = Assert.Single(root.SelectNodes(".//ol | .//ul")!);
        Assert.Equal("footnotes", list.GetAttributeValue("class", ""));
        var item = Assert.Single(list.SelectNodes("./li")!);
        Assert.Equal("fn:3", item.GetAttributeValue("id", ""));
        Assert.StartsWith("גוף", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_StripsABoldElementMarker()
    {
        /* <b> wraps the marker in some generations — it strips like
           <sup>/<strong>. */
        const string html = @"<p>טקסט<sup><a href=""#note-5"" id=""noteref-5"">ה</a></sup></p>
<ol style=""list-style:none""><li id=""note-5""><b>ה.</b> גוף הערה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:5']")!);
        Assert.Null(item.SelectSingleNode(".//b"));
        Assert.StartsWith("גוף", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_StopsTheMarkerScanAtANonMarkerElement()
    {
        /* A leading <em> is not a marker wrapper — the bare-text scan yields
           to it and the note keeps its content. */
        const string html = @"<p>טקסט<sup><a href=""#note-4"" id=""noteref-4"">ד</a></sup></p>
<ol style=""list-style:none""><li id=""note-4""><em>הערה:</em> גוף ההערה</li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:4']")!);
        Assert.NotNull(item.SelectSingleNode(".//em"));
        Assert.StartsWith("הערה:", HtmlEntity.DeEntitize(item.InnerText).Trim());
    }

    [Fact]
    public void Normalize_KeepsOnlyTheFirstBodyWhenTwoElementsClaimOneNumber()
    {
        /* Second registration under an already-taken number is dropped — the
           first body wins and no duplicate item is emitted. */
        const string html = @"<p>טקסט<sup><a href=""#note-8"" id=""noteref-8"">ח</a></sup></p>
<ol style=""list-style:none""><li id=""note-8""><sup>ח</sup> הערה ראשונה</li></ol>
<p id=""note-8""><strong>ח.</strong> כפילות</p>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:8']")!);
        Assert.StartsWith("הערה ראשונה", HtmlEntity.DeEntitize(item.InnerText).Trim());
        /* The losing paragraph stays in place as ordinary prose. */
        Assert.NotNull(root.SelectSingleNode(".//p[@id='note-8']"));
    }

    [Fact]
    public void Normalize_HandlesAnEmptyNoteBody()
    {
        /* An empty <li> body still canonicalizes — the marker scan finds no
           children and the backref attaches to the item itself. */
        const string html = @"<p>טקסט<sup><a href=""#note-6"" id=""noteref-6"">ו</a></sup></p>
<ol style=""list-style:none""><li id=""note-6""></li></ol>";
        var root = Parse(TanahpediaFootnotes.Normalize(html)!);
        var item = Assert.Single(root.SelectNodes(".//*[@id='fn:6']")!);
        Assert.Equal("ו", item.GetAttributeValue("data-marker", ""));
        Assert.Single(item.SelectNodes("./a[contains(@class,'footnote-backref')]")!);
    }

    [Fact]
    public void FromHtml_FootnoteListWithoutDataMarkerFallsBackToListPosition()
    {
        /* Canonical list items authored without data-marker still get Hebrew
           markers — derived from the item's list position. The <p> wrapper
           breaks the line after the marker — collapse whitespace to compare. */
        var runs = HtmlRuns.FromHtml(
            @"<ol class=""footnotes""><li><p>הערה אחת</p></li><li><p>הערה שתיים</p></li></ol>");
        var text = Regex.Replace(string.Concat(runs.Select(r => r.Text)), @"\s+", " ");
        Assert.Contains("א הערה אחת", text);
        Assert.Contains("ב הערה שתיים", text);
    }

    [Fact]
    public void FromHtml_CollapsesLeadingAndConsecutiveBreaks()
    {
        /* A block boundary before any content and back-to-back boundaries
           around <hr> must not accrue blank lines. */
        var runs = HtmlRuns.FromHtml(@"<hr><p>א</p><hr><p>ב</p>");
        var text = string.Concat(runs.Select(r => r.Text));
        Assert.DoesNotContain("\n\n", text);
        Assert.Contains("א", text);
        Assert.Contains("ב", text);
    }

    [Fact]
    public void FromHtml_BulletAndInlineStyleArmsRender()
    {
        /* <ul> bullets, an ordinary <ol> number, a stray <li> with no list
           parent, and the style-tag arms absent from footnote markup —
           nested tags where the second mutation reuses the cloned style. */
        var runs = HtmlRuns.FromHtml(
            @"<ul><li>פריט</li></ul><ol><li>ראשון</li><li>שני</li></ol><li>יתום</li>" +
            @"<p><b><i>כפול</i></b> <u>קו</u> <s>מחוק</s> <sub>תחתית</sub> <small>קטן</small> <big>גדול</big> <pre>  רווח  </pre> <del>דל</del> <ins>תו</ins> <strike>סט</strike> <a>בלי קישור</a> <a href=""#x"">קישור</a> <span>ספאן</span> <strong style=""font-style:italic"">מודגש</strong></p><h3>כותרת</h3>");
        var text = string.Concat(runs.Select(r => r.Text));
        Assert.Contains("• פריט", text);
        Assert.Contains("1. ראשון", text);
        Assert.Contains("• יתום", text);
        Assert.Contains(runs, r => r.Text.Contains("כפול") && r.Bold && r.Italic);
        Assert.Contains(runs, r => r.Text.Contains("קו") && r.Underline);
        Assert.Contains(runs, r => r.Text.Contains("מחוק") && r.Strikethrough);
        Assert.Contains(runs, r => r.Text.Contains("תחתית") && r.BaselineShift == -1);
        Assert.Contains(runs, r => r.Text.Contains("קטן") && r.FontScale < 1.0);
        Assert.Contains(runs, r => r.Text.Contains("גדול") && r.FontScale > 1.0);
        Assert.Contains(runs, r => r.Text.Contains("דל") && r.Strikethrough);
        Assert.Contains(runs, r => r.Text.Contains("תו") && r.Underline);
        Assert.Contains(runs, r => r.Text.Contains("סט") && r.Strikethrough);
        Assert.Contains(runs, r => r.Text.Contains("קישור") && r.Link == "#x");
        Assert.Contains(runs, r => r.Text.Contains("מודגש") && r.Bold && r.Italic);
        Assert.Contains(runs, r => r.Text.Contains("כותרת") && r.HeadingLevel == 3 && r.Bold);
    }
}
