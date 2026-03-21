using HtmlAgilityPack;

namespace BibleOnSite.Helpers;

/// <summary>
/// Extracts media elements (video/audio) from HTML content and splits it into
/// an ordered list of segments that can be rendered with mixed native controls.
/// </summary>
public static class HtmlMediaExtractor
{
    /// <summary>
    /// Parses HTML and returns an ordered list of content segments.
    /// Text segments contain HTML without media tags; media segments carry
    /// the source URL and media type.
    /// </summary>
    public static List<ContentSegment> ExtractSegments(string html)
    {
        var segments = new List<ContentSegment>();

        if (string.IsNullOrWhiteSpace(html))
            return segments;

        var doc = new HtmlDocument();
        doc.LoadHtml(html);

        var htmlBuffer = new System.IO.StringWriter();
        foreach (var node in doc.DocumentNode.ChildNodes)
        {
            if (IsMediaNode(node))
            {
                FlushHtmlBuffer(htmlBuffer, segments);
                var sourceUrl = GetMediaSourceUrl(node);
                if (!string.IsNullOrEmpty(sourceUrl))
                {
                    var type = node.Name.Equals("video", StringComparison.OrdinalIgnoreCase)
                        ? MediaType.Video
                        : MediaType.Audio;
                    segments.Add(new ContentSegment(SegmentKind.Media, null, sourceUrl, type));
                }
            }
            else
            {
                node.WriteTo(htmlBuffer);
            }
        }

        FlushHtmlBuffer(htmlBuffer, segments);
        return segments;
    }

    /// <summary>
    /// Returns true when the HTML contains at least one video or audio element.
    /// </summary>
    public static bool ContainsMedia(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
            return false;

        return html.Contains("<video", StringComparison.OrdinalIgnoreCase)
            || html.Contains("<audio", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsMediaNode(HtmlNode node)
    {
        return node.NodeType == HtmlNodeType.Element
            && (node.Name.Equals("video", StringComparison.OrdinalIgnoreCase)
                || node.Name.Equals("audio", StringComparison.OrdinalIgnoreCase));
    }

    private static string? GetMediaSourceUrl(HtmlNode mediaNode)
    {
        var src = mediaNode.GetAttributeValue("src", string.Empty);
        if (!string.IsNullOrEmpty(src))
            return src;

        var sourceChild = mediaNode.SelectSingleNode(".//source");
        var childSrc = sourceChild?.GetAttributeValue("src", string.Empty);
        return string.IsNullOrEmpty(childSrc) ? null : childSrc;
    }

    private static void FlushHtmlBuffer(System.IO.StringWriter buffer, List<ContentSegment> segments)
    {
        var html = buffer.ToString().Trim();
        if (!string.IsNullOrEmpty(html) && html != "<br>" && html != "<br/>")
        {
            segments.Add(new ContentSegment(SegmentKind.Html, html, null, null));
        }
        buffer.GetStringBuilder().Clear();
    }
}

public enum SegmentKind
{
    Html,
    Media
}

public enum MediaType
{
    Video,
    Audio
}

public record ContentSegment(SegmentKind Kind, string? Html, string? MediaUrl, MediaType? Type);
