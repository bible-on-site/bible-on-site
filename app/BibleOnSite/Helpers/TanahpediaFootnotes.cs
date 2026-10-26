using System.Text.RegularExpressions;
using HtmlAgilityPack;

namespace BibleOnSite.Helpers;

/// <summary>
/// Rewrites stored tanahpedia footnote markup of every generation to the
/// canonical <c>ol.footnotes</c> + <c>fn:N</c>/<c>fnref:N</c> form the admin
/// editor emits — same contract as the website's
/// <c>normalizeFootnoteHtml</c> (#2615/#2639). Entries render correctly
/// without being re-saved:
/// <list type="bullet">
/// <item>ref   <c>&lt;sup&gt;&lt;a href="#note-1" id="noteref-1"&gt;א&lt;/a&gt;&lt;/sup&gt;</c> (legacy)</item>
/// <item>      <c>&lt;a href="#note-54"&gt;נד&lt;/a&gt;</c> (bare anchor)</item>
/// <item>      <c>&lt;sup id="fnref:1"&gt;&lt;a href="#fn:1" role="doc-noteref"&gt;</c> (current)</item>
/// <item>body  <c>&lt;ol style="list-style:none"&gt;&lt;li id="note-1"&gt;&lt;sup&gt;א&lt;/sup&gt;</c></item>
/// <item>      <c>&lt;ol&gt;&lt;li&gt;&lt;p&gt;א טקסט &lt;a href="#noteref-1"&gt;</c> (no ids)</item>
/// <item>      <c>&lt;p id="note-1"&gt;&lt;strong&gt;א.&lt;/strong&gt;</c> (paragraph form)</item>
/// </list>
/// Every legacy generation bakes the Hebrew marker into the markup as text,
/// so the <see cref="HtmlRuns"/> list counter rendered a second marker next to
/// it. After normalization the list owns the marker exactly once.
/// </summary>
public static class TanahpediaFootnotes
{
    private static readonly Regex RefLegacyHref = new(@"^#note-(\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex BodyLegacyId = new(@"^note-(\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex BackrefLegacyHref = new(@"^#noteref-(\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex RefCanonHref = new(@"^#fn:(\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex BodyCanonId = new(@"^fn:(\d+)$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AnyMarker = new(@"fnref:|#note-|#noteref-|id=""note-|footnotes", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex BareMarker = new(@"^\s*([א-ת]{1,4})([.]?)(\s+|$)", RegexOptions.Compiled);

    /// <summary>Normalizes footnote markup; returns the input unchanged when
    /// it contains no recognizable footnote structure (or is null/empty).</summary>
    public static string? Normalize(string? html)
    {
        if (string.IsNullOrEmpty(html) || !AnyMarker.IsMatch(html))
        {
            return html;
        }

        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        var root = doc.DocumentNode;

        /* ---- collect note bodies, keyed by note number ---- */
        var bodies = new SortedDictionary<int, HtmlNode>();
        var bodySet = new HashSet<HtmlNode>();
        void Register(HtmlNode? el, int num)
        {
            var body = el is null ? null : BodyElement(el);
            if (body is not null && num > 0 && !bodies.ContainsKey(num))
            {
                bodies[num] = body;
                bodySet.Add(body);
            }
        }

        foreach (var el in root.SelectNodes(".//*[@id]") ?? Enumerable.Empty<HtmlNode>())
        {
            Register(el, AttrNumber(el, "id", BodyLegacyId));
            Register(el, AttrNumber(el, "id", BodyCanonId));
        }
        foreach (var link in root.SelectNodes(".//a[@href]") ?? Enumerable.Empty<HtmlNode>())
        {
            var match = BackrefLegacyHref.Match(link.GetAttributeValue("href", string.Empty));
            if (match.Success && int.TryParse(match.Groups[1].Value, out var num))
            {
                Register(link, num);
            }
        }

        /* ---- collect references in document order ---- */
        var refs = new List<(HtmlNode Anchor, HtmlNode Host, int Num)>();
        foreach (var anchor in root.SelectNodes(".//a[@href]") ?? Enumerable.Empty<HtmlNode>())
        {
            var href = anchor.GetAttributeValue("href", string.Empty);
            var match = RefCanonHref.Match(href);
            if (!match.Success)
            {
                match = RefLegacyHref.Match(href);
            }
            if (!match.Success || !int.TryParse(match.Groups[1].Value, out var num) || num <= 0)
            {
                continue;
            }
            /* A "#fn:N"/"#note-N" link inside a note is a cross-reference
               between notes, not an inline reference — keep it, but retarget
               the legacy "#note-N" form to the canonical fn:N id its target
               body gets below. */
            if (bodies.Count == 0 || InsideAny(anchor, bodySet))
            {
                anchor.SetAttributeValue("href", $"#fn:{num}");
                continue;
            }
            var host = anchor.ParentNode?.Name == "sup" ? anchor.ParentNode : anchor;
            refs.Add((anchor, host, num));
        }

        var hasFootnoteList = (root.SelectNodes(".//ol[contains(concat(' ', normalize-space(@class), ' '), ' footnotes ')]")
            ?.Count ?? 0) > 0;
        if (bodies.Count == 0 && refs.Count == 0 && !hasFootnoteList)
        {
            return html;
        }

        /* ---- canonicalize note bodies ---- */
        var canonicalList = doc.CreateElement("ol");
        canonicalList.SetAttributeValue("class", "footnotes");
        var placeholder = doc.CreateElement("wbr");
        var anchored = false;
        var processed = new HashSet<HtmlNode>();

        foreach (var (num, body) in bodies)
        {
            /* One body may be reachable under two numbers (an li carrying both
               id="note-1" and a #noteref-2 backlink) — process it once. */
            if (!processed.Add(body))
            {
                continue;
            }
            StripLiteralMarker(body, GimatryHelper.ToLetters(num));

            /* Legacy jump-back links are re-emitted canonically below. */
            foreach (var stale in (body.SelectNodes(".//a[starts-with(@href,'#noteref-')]") ?? Enumerable.Empty<HtmlNode>())
                .Concat(body.SelectNodes(".//a[contains(concat(' ', normalize-space(@class), ' '), ' footnote-backref ')]") ?? Enumerable.Empty<HtmlNode>())
                .ToList())
            {
                stale.Remove();
            }

            HtmlNode item;
            if (body.Name == "li")
            {
                item = body;
                if (!anchored)
                {
                    var container = item.ParentNode;
                    if (container is not null && (container.Name == "ol" || container.Name == "ul"))
                    {
                        /* The canonical list replaces the legacy one wholesale. */
                        container.ParentNode?.InsertBefore(placeholder, container);
                    }
                    else
                    {
                        container?.InsertBefore(placeholder, item);
                    }
                    anchored = true;
                }
            }
            else
            {
                /* Paragraph-form body: the item takes the paragraph's position. */
                item = doc.CreateElement("li");
                if (!anchored)
                {
                    var container = body.ParentNode;
                    if (container is not null && (container.Name == "ol" || container.Name == "ul"))
                    {
                        container.ParentNode?.InsertBefore(placeholder, container);
                    }
                    else
                    {
                        container?.InsertBefore(placeholder, body);
                    }
                    anchored = true;
                }
                while (body.FirstChild is { } child)
                {
                    /* HtmlAgilityPack's AppendChild does not detach the node
                       from its old parent — remove it first. */
                    child.Remove();
                    item.AppendChild(child);
                }
                body.Remove();
            }
            item.SetAttributeValue("id", $"fn:{num}");
            /* The marker travels in data-marker so the renderer displays the
               note's own number — sparse numbering (a lone note 54) must not
               collapse to its list position. */
            item.SetAttributeValue("data-marker", GimatryHelper.ToLetters(num));
            /* Detach before re-adding — HtmlAgilityPack's AppendChild does
               not remove the node from its old parent. */
            item.ParentNode?.RemoveChild(item);
            canonicalList.AppendChild(item);
        }

        if (canonicalList.ChildNodes.Count(n => n.NodeType == HtmlNodeType.Element) > 0)
        {
            if (anchored)
            {
                placeholder.ParentNode?.ReplaceChild(canonicalList, placeholder);
            }
            else
            {
                root.AppendChild(canonicalList);
            }
            /* Drop emptied legacy list wrappers. */
            foreach (var list in (root.SelectNodes(".//ol | .//ul") ?? Enumerable.Empty<HtmlNode>())
                .Where(list => list != canonicalList && !list.ChildNodes.Any(n => n.NodeType == HtmlNodeType.Element))
                .ToList())
            {
                list.Remove();
            }
        }

        /* ---- canonicalize references ---- */
        var firstRefId = new Dictionary<int, string>();
        var usedRefIds = new HashSet<string>();
        foreach (var (anchor, host, num) in refs)
        {
            var refId = $"fnref:{num}";
            var suffix = 2;
            while (!usedRefIds.Add(refId))
            {
                refId = $"fnref:{num}-{suffix++}";
            }
            if (!firstRefId.ContainsKey(num))
            {
                firstRefId[num] = refId;
            }

            anchor.SetAttributeValue("href", $"#fn:{num}");
            anchor.SetAttributeValue("role", "doc-noteref");
            var classes = new HashSet<string>(anchor.GetAttributeValue("class", string.Empty)
                .Split(' ', StringSplitOptions.RemoveEmptyEntries));
            classes.Add("footnote-ref");
            anchor.SetAttributeValue("class", string.Join(' ', classes));
            /* The anchor's visible text is the author's marker already; only
               repair a missing label so the link never renders invisible. */
            if (string.IsNullOrWhiteSpace(HtmlEntity.DeEntitize(anchor.InnerText)))
            {
                anchor.InnerHtml = string.Empty;
                anchor.AppendChild(doc.CreateTextNode(GimatryHelper.ToLetters(num)));
            }

            if (host.Name == "sup")
            {
                host.SetAttributeValue("id", refId);
            }
            else
            {
                var sup = doc.CreateElement("sup");
                sup.SetAttributeValue("id", refId);
                anchor.ParentNode?.ReplaceChild(sup, anchor);
                sup.AppendChild(anchor);
            }
        }

        /* ---- canonical jump-back link on every note ---- */
        foreach (var item in canonicalList.ChildNodes.Where(n => n.NodeType == HtmlNodeType.Element))
        {
            var num = AttrNumber(item, "id", BodyCanonId);
            var link = doc.CreateElement("a");
            link.SetAttributeValue("class", "footnote-backref");
            link.SetAttributeValue("href", $"#{(firstRefId.TryGetValue(num, out var r) ? r : $"fnref:{num}")}");
            link.SetAttributeValue("role", "doc-backlink");
            link.SetAttributeValue("aria-label", $"חזרה לאזכור {GimatryHelper.ToLetters(num)}");
            link.AppendChild(doc.CreateTextNode("↩"));
            /* Canonical notes wrap their text in <p> — the backref belongs at
               the end of that paragraph, not inside a trailing inline element
               like <sup> where it would render super-scripted. */
            var target = item.ChildNodes.LastOrDefault(
                n => n.NodeType == HtmlNodeType.Element && n.Name == "p") ?? item;
            target.AppendChild(link);
        }

        return root.InnerHtml;
    }

    /// <summary>Elements that may hold a footnote body: the node itself or an
    /// <c>li</c>/<c>p</c> ancestor — the nearest <c>li</c> wins, so a backlink
    /// inside <c>&lt;li&gt;&lt;p&gt;…&lt;/p&gt;&lt;/li&gt;</c> resolves to the
    /// list item (same precedence as the website's
    /// <c>closest("li") ?? closest("p")</c>).</summary>
    private static HtmlNode? BodyElement(HtmlNode el)
    {
        if (el.NodeType == HtmlNodeType.Element && el.Name is "li" or "p")
        {
            return el;
        }
        for (var node = el.ParentNode; node is not null; node = node.ParentNode)
        {
            if (node.Name == "li")
            {
                return node;
            }
        }
        for (var node = el.ParentNode; node is not null; node = node.ParentNode)
        {
            if (node.Name == "p")
            {
                return node;
            }
        }
        return null;
    }

    private static bool InsideAny(HtmlNode node, HashSet<HtmlNode> containers)
    {
        for (var parent = node; parent is not null; parent = parent.ParentNode)
        {
            if (containers.Contains(parent))
            {
                return true;
            }
        }
        return false;
    }

    private static int AttrNumber(HtmlNode el, string attr, Regex pattern)
    {
        var match = pattern.Match(el.GetAttributeValue(attr, string.Empty));
        return match.Success && int.TryParse(match.Groups[1].Value, out var num) && num > 0 ? num : 0;
    }

    /// <summary>
    /// Removes the hand-baked Hebrew marker at the start of a note body — a
    /// leading <c>sup</c>/<c>strong</c> element or leading text — but only when
    /// its content is exactly the expected marker for this note number. A
    /// paragraph that happens to begin with a Hebrew word is left untouched.
    /// </summary>
    private static void StripLiteralMarker(HtmlNode body, string marker)
    {
        var host = body.ChildNodes.FirstOrDefault(n => n.Name == "p") ?? body;

        /* Element-wrapped marker: <sup>א</sup> or <strong>א.</strong>. */
        var first = host.ChildNodes.FirstOrDefault(n => n.NodeType == HtmlNodeType.Element);
        if (first is not null && first.Name is "sup" or "strong" or "b")
        {
            var text = HtmlEntity.DeEntitize(first.InnerText).Trim().TrimEnd('.', ' ', ' ');
            if (text == marker)
            {
                first.Remove();
            }
            return;
        }

        /* Bare text marker: `א טקסט` / `א. טקסט` / `נד טקסט`. */
        foreach (var node in host.ChildNodes.ToList())
        {
            if (node.NodeType != HtmlNodeType.Text)
            {
                break;
            }
            var decoded = HtmlEntity.DeEntitize(node.InnerText);
            var match = BareMarker.Match(decoded);
            if (!match.Success || match.Groups[1].Value != marker)
            {
                return;
            }
            node.ParentNode?.ReplaceChild(
                node.OwnerDocument.CreateTextNode(decoded[match.Length..]), node);
            return;
        }
    }
}
