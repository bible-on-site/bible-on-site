namespace BibleOnSite.Config;

/// <summary>Explicit Debug build opt-in; ordinary builds keep their existing startup.</summary>
public static class HomeUxPreview
{
    public static bool Enabled =>
#if HOME_UX_PREVIEW
        true;
#else
        false;
#endif
}
