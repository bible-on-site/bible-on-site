using System.Text;
using HtmlAgilityPack;

namespace BibleOnSite.Helpers;

/// <summary>
/// A run of text with the inline formatting that applies to it. Produced by
/// <see cref="HtmlRuns.FromHtml"/> as a platform-neutral rendering model that
/// platform handlers map onto their native attributed-string types.
/// </summary>
public sealed record HtmlRun
{
    public required string Text { get; init; }
    public bool Bold { get; init; }
    public bool Italic { get; init; }
    public bool Underline { get; init; }
    public bool Strikethrough { get; init; }
    /// <summary>+1 superscript, -1 subscript, 0 normal baseline.</summary>
    public int BaselineShift { get; init; }
    /// <summary>Multiplier applied to the view's effective font size.</summary>
    public double FontScale { get; init; } = 1.0;
    /// <summary>1-6 for h1-h6 elements, 0 for non-headings.</summary>
    public int HeadingLevel { get; init; }
    /// <summary>Link target for &lt;a href&gt; runs.</summary>
    public string? Link { get; init; }
}

/// <summary>
/// Converts HTML fragments into styled text runs with a managed parser only.
/// Replaces WebKitLegacy's NSHTMLReader/NSAttributedString import, which always
/// executes the actual parse on the main thread via performSelectorOnMainThread —
/// re-entering UICollectionView updates and aborting the app (TestFlight
/// incidents F0AF3C74 and 351F87DB). Runs are emitted in document order with
/// HTML whitespace collapsing and block-level newline boundaries.
/// </summary>
public static class HtmlRuns
{
    private static readonly HashSet<string> SkipContentTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "script", "style", "noscript", "template", "head", "title", "meta", "link",
        "svg", "canvas", "iframe", "object", "embed", "button", "select", "textarea", "input"
    };

    private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase)
    {
        "p", "div", "section", "article", "header", "footer", "aside", "main",
        "figure", "figcaption", "blockquote", "ul", "ol", "dl", "dt", "dd",
        "table", "thead", "tbody", "tfoot", "tr", "pre", "hr", "form",
        "fieldset", "nav", "address", "h1", "h2", "h3", "h4", "h5", "h6",
        "html", "body"
    };

    /// <summary>
    /// Parses HTML into styled runs. Tolerates malformed markup; unknown tags
    /// are transparent (their children still render). Returns an empty list for
    /// null/whitespace input or content that yields no text.
    /// </summary>
    public static IReadOnlyList<HtmlRun> FromHtml(string? html)
    {
        var context = new Context();
        if (string.IsNullOrWhiteSpace(html))
        {
            return context.Runs;
        }

        var doc = new HtmlDocument();
        doc.LoadHtml(html);
        foreach (var child in doc.DocumentNode.ChildNodes)
        {
            Walk(child, new Style(), context);
        }
        context.Flush();

        // A final block boundary emits a '\n' that would render as an extra
        // blank line at the bottom of the cell — trim trailing whitespace.
        while (context.Runs.Count > 0)
        {
            var last = context.Runs[^1];
            var trimmed = last.Text.TrimEnd();
            if (trimmed.Length == last.Text.Length)
            {
                break;
            }
            if (trimmed.Length == 0)
            {
                context.Runs.RemoveAt(context.Runs.Count - 1);
            }
            else
            {
                context.Runs[^1] = last with { Text = trimmed };
                break;
            }
        }
        return context.Runs;
    }

    private sealed class Style
    {
        public bool Bold;
        public bool Italic;
        public bool Underline;
        public bool Strikethrough;
        public int BaselineShift;
        public double FontScale = 1.0;
        public int HeadingLevel;
        public string? Link;
        public bool PreserveWhitespace;

        public Style Clone() => (Style)MemberwiseClone();
    }

    private sealed class Context
    {
        public readonly List<HtmlRun> Runs = new();
        private readonly StringBuilder _text = new();
        private Style _pendingStyle = new();

        /// <summary>
        /// Whitespace collapsed at a text node's edge waits here for the next
        /// text node — a tag boundary must not drop the separator space.
        /// </summary>
        public bool PendingSpace;

        /// <summary>Last emitted character across the buffer and flushed runs.</summary>
        public char? LastChar =>
            _text.Length > 0 ? _text[^1] : (Runs.Count > 0 ? Runs[^1].Text[^1] : null);

        /// <summary>Appends text under a style; emits a run when the style changes.</summary>
        public void Append(string text, Style style)
        {
            if (text.Length == 0)
            {
                return;
            }
            if (_text.Length > 0 && !SameStyle(_pendingStyle, style))
            {
                Flush();
            }
            _pendingStyle = style;
            _text.Append(text);
        }

        /// <summary>Ends the current line, collapsing consecutive breaks.</summary>
        public void Break()
        {
            PendingSpace = false;
            Flush();
            if (Runs.Count > 0 && LastChar != '\n')
            {
                Append("\n", new Style());
            }
        }

        /// <summary>Emits the buffered text as a run under its pending style.</summary>
        public void Flush()
        {
            if (_text.Length == 0)
            {
                return;
            }
            var style = _pendingStyle;
            Runs.Add(new HtmlRun
            {
                Text = _text.ToString(),
                Bold = style.Bold,
                Italic = style.Italic,
                Underline = style.Underline,
                Strikethrough = style.Strikethrough,
                BaselineShift = style.BaselineShift,
                FontScale = style.FontScale,
                HeadingLevel = style.HeadingLevel,
                Link = style.Link
            });
            _text.Clear();
        }

        private static bool SameStyle(Style a, Style b) =>
            a.Bold == b.Bold && a.Italic == b.Italic && a.Underline == b.Underline &&
            a.Strikethrough == b.Strikethrough && a.BaselineShift == b.BaselineShift &&
            Math.Abs(a.FontScale - b.FontScale) < 0.0001 &&
            a.HeadingLevel == b.HeadingLevel && a.Link == b.Link;
    }

    private static void Walk(HtmlNode node, Style style, Context context)
    {
        if (node.NodeType == HtmlNodeType.Text)
        {
            AppendText(node, style, context);
            return;
        }
        if (node.NodeType != HtmlNodeType.Element)
        {
            return;
        }

        var tag = node.Name;
        if (SkipContentTags.Contains(tag))
        {
            return;
        }

        if (tag.Equals("br", StringComparison.OrdinalIgnoreCase))
        {
            context.Break();
            return;
        }
        if (tag.Equals("hr", StringComparison.OrdinalIgnoreCase))
        {
            context.Break();
            context.Append("\u2015\u2015\u2015", style);
            context.Break();
            return;
        }
        if (tag.Equals("img", StringComparison.OrdinalIgnoreCase))
        {
            var alt = node.GetAttributeValue("alt", string.Empty);
            if (!string.IsNullOrWhiteSpace(alt))
            {
                context.Append(alt, style);
            }
            return;
        }

        var childStyle = ApplyTag(node, tag, style);

        if (tag.Equals("li", StringComparison.OrdinalIgnoreCase))
        {
            context.Break();
            context.Append(ListMarker(node), childStyle);
        }
        else if (BlockTags.Contains(tag))
        {
            context.Break();
        }

        foreach (var child in node.ChildNodes)
        {
            Walk(child, childStyle, context);
        }

        if (tag.Equals("td", StringComparison.OrdinalIgnoreCase) ||
            tag.Equals("th", StringComparison.OrdinalIgnoreCase))
        {
            context.Append("  ", childStyle);
        }
        else if (tag.Equals("li", StringComparison.OrdinalIgnoreCase) || BlockTags.Contains(tag))
        {
            context.Break();
        }
    }

    private static string ListMarker(HtmlNode liNode)
    {
        for (var parent = liNode.ParentNode; parent != null; parent = parent.ParentNode)
        {
            if (parent.Name.Equals("ul", StringComparison.OrdinalIgnoreCase))
            {
                return "\u2022 ";
            }
            if (parent.Name.Equals("ol", StringComparison.OrdinalIgnoreCase))
            {
                var number = 1;
                foreach (var sibling in parent.ChildNodes)
                {
                    if (sibling == liNode)
                    {
                        break;
                    }
                    if (sibling.Name.Equals("li", StringComparison.OrdinalIgnoreCase))
                    {
                        number++;
                    }
                }
                return $"{number}. ";
            }
        }
        return "\u2022 ";
    }

    private static Style ApplyTag(HtmlNode node, string tag, Style parent)
    {
        var style = parent;
        Style Mutated()
        {
            if (ReferenceEquals(style, parent))
            {
                style = parent.Clone();
            }
            return style;
        }

        switch (tag.ToLowerInvariant())
        {
            case "b":
            case "strong":
                Mutated().Bold = true;
                break;
            case "i":
            case "em":
                Mutated().Italic = true;
                break;
            case "u":
            case "ins":
                Mutated().Underline = true;
                break;
            case "s":
            case "strike":
            case "del":
                Mutated().Strikethrough = true;
                break;
            case "sup":
                Mutated().BaselineShift = 1;
                Mutated().FontScale = parent.FontScale * 0.75;
                break;
            case "sub":
                Mutated().BaselineShift = -1;
                Mutated().FontScale = parent.FontScale * 0.75;
                break;
            case "small":
                Mutated().FontScale = parent.FontScale * 0.83;
                break;
            case "big":
                Mutated().FontScale = parent.FontScale * 1.17;
                break;
            case "pre":
                Mutated().PreserveWhitespace = true;
                break;
            case "a":
                var href = node.GetAttributeValue("href", null);
                if (!string.IsNullOrWhiteSpace(href))
                {
                    Mutated().Link = href;
                    Mutated().Underline = true;
                }
                break;
            case { } t when t.Length == 2 && t[0] == 'h' && t[1] >= '1' && t[1] <= '6':
                // FontScale stays untouched: the handler maps HeadingLevel onto the
                // view's H1-H3FontSizeMultiplier settings instead of a fixed scale.
                var heading = Mutated();
                heading.Bold = true;
                heading.HeadingLevel = t[1] - '0';
                break;
            default:
                // Unrecognized elements keep the inherited style; their
                // children are still walked.
                break;
        }

        var inlineStyle = node.GetAttributeValue("style", null);
        if (!string.IsNullOrEmpty(inlineStyle))
        {
            ApplyInlineStyle(inlineStyle, Mutated);
        }
        return style;
    }

    /// <summary>Applies the subset of inline CSS declarations we can render.</summary>
    private static void ApplyInlineStyle(string css, Func<Style> mutate)
    {
        foreach (var declaration in css.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var colon = declaration.IndexOf(':');
            if (colon <= 0)
            {
                continue;
            }
            var name = declaration[..colon].Trim().ToLowerInvariant();
            var value = declaration[(colon + 1)..].Trim().ToLowerInvariant();
            switch (name)
            {
                case "font-weight" when value is "bold" or "bolder" or "600" or "700" or "800" or "900":
                    mutate().Bold = true;
                    break;
                case "font-style" when value is "italic" or "oblique":
                    mutate().Italic = true;
                    break;
                case "text-decoration" or "text-decoration-line"
                    when value.Contains("underline"):
                    mutate().Underline = true;
                    break;
                case "text-decoration" or "text-decoration-line"
                    when value.Contains("line-through"):
                    mutate().Strikethrough = true;
                    break;
                case "vertical-align" when value is "super":
                    mutate().BaselineShift = 1;
                    break;
                case "vertical-align" when value is "sub":
                    mutate().BaselineShift = -1;
                    break;
                case "font-size":
                    ApplyFontSize(value, mutate);
                    break;
                default:
                    // Unknown CSS properties are ignored.
                    break;
            }
        }
    }

    private static void ApplyFontSize(string value, Func<Style> mutate)
    {
        if (value.EndsWith('%') &&
            double.TryParse(value[..^1], out var percent))
        {
            mutate().FontScale *= percent / 100.0;
        }
        else if (value.EndsWith("em") &&
            double.TryParse(value[..^2], out var em))
        {
            mutate().FontScale *= em;
        }
        else if (value is "smaller" or "x-small" or "xx-small")
        {
            mutate().FontScale *= 0.83;
        }
        else if (value is "larger" or "x-large" or "xx-large")
        {
            mutate().FontScale *= 1.17;
        }
    }

    private static void AppendText(HtmlNode node, Style style, Context context)
    {
        var text = HtmlEntity.DeEntitize(node.InnerText);
        if (style.PreserveWhitespace)
        {
            context.Append(text, style);
            return;
        }
        AppendCollapsed(text, style, context);
    }

    /// <summary>HTML whitespace collapsing: runs of spaces/tabs/newlines become one space.</summary>
    private static void AppendCollapsed(string text, Style style, Context context)
    {
        var pendingSpace = context.PendingSpace;
        context.PendingSpace = false;
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            if (char.IsWhiteSpace(ch))
            {
                pendingSpace = true;
                continue;
            }
            if (pendingSpace &&
                (builder.Length > 0 || context.LastChar is { } last && last != ' ' && last != '\n'))
            {
                builder.Append(' ');
            }
            pendingSpace = false;
            builder.Append(ch);
        }
        // Trailing whitespace stays pending — a following text node may still
        // need the separator; a block boundary consumes it via Break().
        context.PendingSpace = pendingSpace;
        context.Append(builder.ToString(), style);
    }
}
