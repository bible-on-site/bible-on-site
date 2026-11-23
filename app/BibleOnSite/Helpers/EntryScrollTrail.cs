namespace BibleOnSite.Helpers;

/// <summary>
/// Per-visit scroll history for the in-place Tanahpedia entry trail: each
/// forward hop pushes the outgoing entry's offset onto its own frame, so a
/// revisit never overwrites an earlier visit's position the way a name-keyed
/// map would (#2640). A Back replay pops one frame — the same frame the
/// entry trail popped — and replays that visit's offset.
/// </summary>
internal sealed class EntryScrollTrail
{
    private readonly Stack<(string Name, double Offset)> _frames = new();

    public int Count => _frames.Count;

    /// <summary>Records where the outgoing visit left off. Called on every
    /// forward hop; the route-applied first entry has no outgoing frame, so
    /// an empty name records nothing.</summary>
    public void PushOutgoing(string outgoingName, double offset)
    {
        if (outgoingName.Length > 0)
        {
            _frames.Push((outgoingName, offset));
        }
    }

    /// <summary>Pops the frame Back consumed and returns its offset when it
    /// belongs to <paramref name="restoredName"/>; a desynced frame is dropped
    /// either way so the count keeps tracking the entry trail.</summary>
    public double? PopForReplay(string restoredName)
    {
        if (_frames.Count == 0)
        {
            return null;
        }

        var frame = _frames.Pop();
        return frame.Name == restoredName ? frame.Offset : null;
    }
}
