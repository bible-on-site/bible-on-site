namespace BibleOnSite.Helpers;

/// <summary>
/// Shared haptic feedback for the reader pages' selection flows.
/// </summary>
public static class SelectionHaptics
{
    /// <summary>Triggers haptic feedback (vibration) for selection mode entry.</summary>
    public static void Trigger()
    {
        try
        {
#if ANDROID
            Vibration.Vibrate(TimeSpan.FromMilliseconds(50));
#elif IOS
            HapticFeedback.Perform(HapticFeedbackType.LongPress);
#endif
        }
        #pragma warning disable S2221 // Deliberate failure boundary: haptic feedback is best-effort
        catch (Exception ex) //NOSONAR — haptic feedback is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Haptic feedback failed: {ex.Message}");
        }
    }
}
