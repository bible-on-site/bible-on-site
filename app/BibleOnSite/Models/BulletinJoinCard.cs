namespace BibleOnSite.Models;

/// <summary>
/// One daily-bulletin join card in the עלון יומי carousel (#2806): channel
/// branding, Hebrew copy, the public join target and the error shown when the
/// external app cannot be opened.
/// </summary>
public sealed record BulletinJoinCard(
    string Key,
    string Title,
    string Icon,
    string BrandColorHex,
    string Description,
    string JoinLabel,
    string SemanticDescription,
    Uri JoinUri,
    string FailureMessage)
{
    /// <summary>The channel brand color used for the card header and join button.</summary>
    public Color BrandColor => Color.FromArgb(BrandColorHex);

    /// <summary>Stable e2e/accessibility identifier for the card's join button.</summary>
    public string AutomationId => $"BulletinJoin{Key[..1].ToUpperInvariant()}{Key[1..]}";
}

/// <summary>
/// The three daily-bulletin join channels, mirroring the website's public join
/// surface (#2806). The website currently arranges bulletin subscriptions
/// through its published contact channels (its /dailyBulletin and
/// /whatsappGroup routes land on the contact section) until the dedicated
/// signup contract ships — see "Restore public email signup and channel/group
/// join links" in docs/daily-bulletin/daily-bulletin.md. Only public
/// destinations belong here: never private test groups, test destination IDs
/// or API keys.
/// </summary>
public static class BulletinJoinCards
{
    public static string TelegramKey => "telegram";
    public static string WhatsAppKey => "whatsapp";
    public static string EmailKey => "email";

    /// <summary>The verified production Telegram bulletin channel (#2806).</summary>
    private static readonly Uri TelegramChannelUri = new("https://t.me/alhaperek");

    /// <summary>
    /// The website's published WhatsApp join number (ContactSection). The
    /// prefilled text marks the request as a bulletin join rather than a
    /// general contact ping.
    /// </summary>
    private static readonly Uri WhatsAppJoinUri = new(
        "https://wa.me/37257078640?text=" + Uri.EscapeDataString("הצטרפות לעלון היומי"));

    /// <summary>
    /// The website's published subscription email (ContactSection) with a join
    /// subject, until the shared public signup API exists.
    /// </summary>
    private static readonly Uri EmailJoinUri = new(
        "mailto:tanah.site@gmail.com?subject=" + Uri.EscapeDataString("הצטרפות לעלון היומי"));

    /// <summary>Card order matches the website carousel: Telegram, WhatsApp, email.</summary>
    public static IReadOnlyList<BulletinJoinCard> All { get; } =
    [
        new BulletinJoinCard(
            Key: TelegramKey,
            Title: "טלגרם",
            Icon: "telegram.png",
            BrandColorHex: "#517BA3",
            Description: "העלון היומי בערוץ הטלגרם",
            JoinLabel: "הצטרפות",
            SemanticDescription: "הצטרפות לעלון היומי בטלגרם",
            JoinUri: TelegramChannelUri,
            FailureMessage: "לא ניתן לפתוח את טלגרם. נסו שוב"),
        new BulletinJoinCard(
            Key: WhatsAppKey,
            Title: "קבוצת ווטסאפ",
            Icon: "whatsapp.png",
            BrandColorHex: "#075E55",
            Description: "העלון היומי ישירות לטלפון",
            JoinLabel: "הצטרפות",
            SemanticDescription: "הצטרפות לעלון היומי בקבוצת הווטסאפ",
            JoinUri: WhatsAppJoinUri,
            FailureMessage: "לא ניתן לפתוח את וואטסאפ. נסו שוב"),
        new BulletinJoinCard(
            Key: EmailKey,
            Title: "דוא\"ל",
            Icon: "gmail.png",
            BrandColorHex: "#404040",
            Description: "העלון היומי במייל",
            JoinLabel: "הצטרפות",
            SemanticDescription: "הצטרפות לעלון היומי בדוא\"ל",
            JoinUri: EmailJoinUri,
            FailureMessage: "לא ניתן לפתוח את אפליקציית הדואר. נסו שוב"),
    ];

    /// <summary>
    /// Resolves a ?channel= deep-link key (e.g. the flyout קבוצת ווטסאפ entry)
    /// to a carousel position; unknown keys land on the first card.
    /// </summary>
    public static int PositionForKey(string? key)
    {
        for (var index = 0; index < All.Count; index++)
        {
            if (string.Equals(All[index].Key, key, StringComparison.OrdinalIgnoreCase))
            {
                return index;
            }
        }

        return 0;
    }
}
