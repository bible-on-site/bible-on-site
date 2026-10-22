namespace BibleOnSite.Tests.MobileE2E.Configuration;

internal static class AppiumLog
{
    // A session-creation timeout leaves no driver state to capture; the
    // server-side stall (WDA/xcodebuild handshake, install, launch) only
    // exists in appium.log. Keep a bounded tail so a failed startup explains
    // which operation stalled without shipping megabytes of log (#2431).
    public static string Tail(string artifactDirectory, int maxBytes = 65536)
    {
        var path = Path.Join(artifactDirectory, "appium.log");
        if (!File.Exists(path))
        {
            return string.Empty;
        }
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var length = Math.Min(stream.Length, maxBytes);
        stream.Seek(-length, SeekOrigin.End);
        var buffer = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            offset += stream.Read(buffer, offset, (int)length - offset);
        }
        return System.Text.Encoding.UTF8.GetString(buffer);
    }
}
