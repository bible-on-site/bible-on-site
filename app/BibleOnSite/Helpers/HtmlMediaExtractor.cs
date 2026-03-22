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

        var mediaNodes = doc.DocumentNode.Descendants()
            .Where(IsMediaNode)
            .ToList();

        if (mediaNodes.Count == 0)
        {
            var trimmed = html.Trim();
            if (!string.IsNullOrEmpty(trimmed))
                segments.Add(new ContentSegment(SegmentKind.Html, trimmed, null, null));
            return segments;
        }

        var mediaMap = new Dictionary<string, (string? Url, MediaType Type)>();
        foreach (var mediaNode in mediaNodes)
        {
            var sourceUrl = GetMediaSourceUrl(mediaNode);
            var type = mediaNode.Name.Equals("video", StringComparison.OrdinalIgnoreCase)
                ? MediaType.Video
                : MediaType.Audio;
            var placeholder = $"<!--MEDIA_{mediaMap.Count}-->";
            mediaMap[placeholder] = (sourceUrl, type);

            var placeholderNode = HtmlNode.CreateNode(placeholder);
            mediaNode.ParentNode.ReplaceChild(placeholderNode, mediaNode);
        }

        var resultHtml = doc.DocumentNode.InnerHtml;
        var parts = System.Text.RegularExpressions.Regex.Split(resultHtml, @"(<!--MEDIA_\d+-->)");

        foreach (var part in parts)
        {
            if (mediaMap.TryGetValue(part, out var media))
            {
                if (!string.IsNullOrEmpty(media.Url))
                    segments.Add(new ContentSegment(SegmentKind.Media, null, media.Url, media.Type));
            }
            else
            {
                var trimmed = part.Trim();
                if (!string.IsNullOrEmpty(trimmed) && trimmed != "<br>" && trimmed != "<br/>")
                    segments.Add(new ContentSegment(SegmentKind.Html, trimmed, null, null));
            }
        }

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
