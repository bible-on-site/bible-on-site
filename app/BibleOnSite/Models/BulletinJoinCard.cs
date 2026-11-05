using BibleOnSite.Config;

namespace BibleOnSite.Models;

/// <summary>
/// One daily-bulletin join card on the עלון יומי page (#2806): channel
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
/// surface (#2942). Every card points at the website's stable first-party
/// join route (#2939/#2940): /bulletin/telegram/join and
/// /bulletin/whatsapp/join answer 307 to the current admin-managed
/// destination and /bulletin/email/join is the shared public signup page, so
/// a destination or invitation change in admin reaches installed app versions
/// without an app release. Only these first-party routes belong here: never
/// rotating provider invitations, private test destinations or API keys.
/// </summary>
public static class BulletinJoinCards
{
    public static string TelegramKey => "telegram";
    public static string WhatsAppKey => "whatsapp";
    public static string EmailKey => "email";

    /// <summary>
    /// The website's canonical first-party join route for a channel. The
    /// production host is fixed: the routes only resolve server-side, so the
    /// app always hands the OS the same stable URL.
    /// </summary>
    private static Uri JoinRoute(string channel) =>
        new($"{AppConfig.Instance.WebsiteUrl}/bulletin/{channel}/join");

    /// <summary>Card order matches the website carousel: Telegram, WhatsApp, email.</summary>
    public static IReadOnlyList<BulletinJoinCard> All { get; } =
    [
        new BulletinJoinCard(
            Key: TelegramKey,
            Title: "טלגרם",
            Icon: "telegram.png",
            BrandColorHex: "#517BA3",
            Description: "ערוץ הטלגרם של העלון - פרק יומי ומבזקים קצרים.",
            JoinLabel: "הצטרפות לערוץ",
            SemanticDescription: "הצטרפות לעלון היומי בטלגרם",
            JoinUri: JoinRoute(TelegramKey),
            FailureMessage: "לא ניתן לפתוח את קישור הטלגרם. נסו שוב"),
        new BulletinJoinCard(
            Key: WhatsAppKey,
            Title: "ווטסאפ",
            Icon: "whatsapp.png",
            BrandColorHex: "#075E55",
            Description: "קבוצת הווטסאפ של העלון - פרק יומי ישירות לטלפון.",
            JoinLabel: "הצטרפות לקבוצה",
            SemanticDescription: "הצטרפות לעלון היומי בווטסאפ",
            JoinUri: JoinRoute(WhatsAppKey),
            FailureMessage: "לא ניתן לפתוח את קישור הווטסאפ. נסו שוב"),
        new BulletinJoinCard(
            Key: EmailKey,
            Title: "דוא\"ל",
            Icon: "envelope.png",
            BrandColorHex: "#404040",
            Description: "העלון היומי בתיבת הדוא\"ל שלכם, כל בוקר.",
            JoinLabel: "הרשמה",
            SemanticDescription: "הרשמה לעלון היומי בדוא\"ל",
            JoinUri: JoinRoute(EmailKey),
            FailureMessage: "לא ניתן לפתוח את דף ההרשמה. נסו שוב"),
    ];

    /// <summary>
    /// Resolves a ?channel= deep-link key to a card index; unknown keys land
    /// on the first card.
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
