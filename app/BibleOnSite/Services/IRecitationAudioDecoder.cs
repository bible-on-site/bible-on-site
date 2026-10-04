namespace BibleOnSite.Services;

/// <summary>Produce a PCM clip from complete, gapless-decoded source audio.</summary>
public interface IRecitationAudioDecoder
{
    Task<byte[]> CreateClipAsync(string mp3, IReadOnlyList<(double Start, double End)> ranges,
        CancellationToken cancellationToken);
}
