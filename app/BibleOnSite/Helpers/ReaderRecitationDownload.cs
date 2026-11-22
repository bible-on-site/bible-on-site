namespace BibleOnSite.Helpers;

/// <summary>
/// One reader "download this sefer then play" request (#3704): the first
/// deliberate Play tap starts the sefer's pack download, repeated taps join
/// the same in-flight request instead of queueing extra downloads or playback
/// starts, and a perek change / page exit / קריינות-off cancels the pending
/// auto-play. A successful download runs the stored play action exactly once.
/// </summary>
public sealed class ReaderRecitationDownload
{
    private (int PerekId, CancellationTokenSource Source)? _pending;

    /// <summary>The perek whose download→play request is in flight, or null.</summary>
    public int? PendingPerekId => _pending?.PerekId;

    /// <summary>Whether a request is in flight — the button's busy state.</summary>
    public bool IsPending => _pending != null;

    /// <summary>
    /// Cancels the pending request: the in-flight download stops where its
    /// delegate honors the token, and the stored play never runs.
    /// </summary>
    public void Cancel()
    {
        try
        {
            _pending?.Source.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // The request's finally already disposed the token between reads.
        }
        _pending = null;
    }

    /// <summary>
    /// Runs the sefer download, then the stored play. Returns false when the
    /// tap only joined an in-flight request for the same perek (that request
    /// still plays) or when a newer request or a cancel superseded this one
    /// before playback began.
    /// </summary>
    public async Task<bool> RunAsync(int perekId, Func<CancellationToken, Task> download, Func<Task> play)
    {
        if (_pending?.PerekId == perekId)
        {
            // Join — this tap is already represented by the pending request.
            return false;
        }

        Cancel();
        using var source = new CancellationTokenSource();
        _pending = (perekId, source);
        try
        {
            await download(source.Token);
            if (source.IsCancellationRequested || _pending?.Source != source)
            {
                return false;
            }

            await play();
            return true;
        }
        finally
        {
            // A newer request already replaced _pending — its state wins.
            if (_pending?.Source == source)
            {
                _pending = null;
            }
        }
    }
}
