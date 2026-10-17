using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Decides which binding contexts may arm a press that native dispatch never
/// delivered to the touched view (a settling RecyclerView can consume Down
/// before it reaches the target). Kept pure and managed-only so the per-Down
/// scan in LongPressBehavior.BeginUnreceivedPress can reject every
/// non-candidate without a single JNI call.
/// </summary>
public static class PressArming
{
    /// <summary>
    /// True when <paramref name="bindingContext"/> belongs to the visible perek:
    /// either the perek itself (the perek header label and the tikkun flow both
    /// bind the carousel's <see cref="Perek"/> item) or a <see cref="Pasuk"/> of
    /// its <see cref="Perek.Pasukim"/>. Pasuk rows bind
    /// <see cref="PasukDisplayItem"/>, never <see cref="Pasuk"/> directly, so
    /// they are not candidates here — they receive Down through their own
    /// native Touch handler instead.
    /// </summary>
    public static bool IsCandidate(object? bindingContext, Perek currentPerek) =>
        ReferenceEquals(bindingContext, currentPerek) ||
        (bindingContext is Pasuk pasuk && currentPerek.Pasukim.Contains(pasuk));
}
