using System.Text;

namespace BibleOnSite.Config;

/// <summary>
/// The packaged/env app-signing credential for the API access gate (#3066):
/// a <c>key-id:secret</c> pair injected at package time via the gitignored
/// <c>Resources/Raw/api-signing-key.txt</c> asset (the same channel as
/// mapbox-token.txt) or the <c>API_SIGNING_KEY</c> env override. The key-id
/// identifies the credential cohort on the wire; the secret never leaves the
/// client as plaintext — only an HMAC over the request does.
/// </summary>
public sealed record ApiSigningCredential(string KeyId, byte[] Secret)
{
    /// <summary>
    /// Parses a <c>key-id:secret</c> value; null when malformed. Each side is
    /// trimmed exactly like the API's <c>parse_signing_keys</c>, so
    /// <c>k1: secret</c> signs with the same bytes the server verifies.
    /// </summary>
    public static ApiSigningCredential? Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }
        raw = raw.Trim();
        var separator = raw.IndexOf(':');
        if (separator < 0)
        {
            return null;
        }
        var keyId = raw[..separator].Trim();
        var secret = raw[(separator + 1)..].Trim();
        if (keyId.Length == 0 || secret.Length == 0)
        {
            return null;
        }
        return new ApiSigningCredential(keyId, Encoding.UTF8.GetBytes(secret));
    }
}
