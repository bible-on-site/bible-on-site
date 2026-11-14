using System.Text;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds a screen-reader name for a list/collection item from the text
/// shown inside it (#2766). Windows otherwise announces every CollectionView
/// row as "Microsoft.Maui.Controls.Platform.ItemTemplateContext".
/// </summary>
public static class AccessibleItemText
{
    /// <summary>
    /// Joins the visible text parts with ", ", dropping icon-font glyphs
    /// (Unicode private-use code points) and collapsing whitespace.
    /// Hebrew letters, niqqud and cantillation marks are kept as-is.
    /// </summary>
    public static string Compose(IEnumerable<string?> parts) =>
        string.Join(", ", parts.Select(Clean).Where(p => p.Length > 0));

    private static string Clean(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(text.Length);
        var pendingSpace = false;
        Span<char> utf16 = stackalloc char[2];
        foreach (var rune in text.EnumerateRunes())
        {
            if (IsPrivateUse(rune.Value))
            {
                continue;
            }

            if (Rune.IsWhiteSpace(rune))
            {
                pendingSpace = builder.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                builder.Append(' ');
                pendingSpace = false;
            }

            builder.Append(utf16[..rune.EncodeToUtf16(utf16)]);
        }

        return builder.ToString();
    }

    private static bool IsPrivateUse(int codePoint) =>
        codePoint is (>= 0xE000 and <= 0xF8FF) or >= 0xF0000;
}
