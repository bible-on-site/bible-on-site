namespace BibleOnSite.Services;

/// <summary>Produce a PCM clip from complete, gapless-decoded source audio.</summary>
public interface IRecitationAudioDecoder
{
    Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges,
        CancellationToken cancellationToken);
    Task<byte[]> CreateClipAsync(string audio, IReadOnlyList<(double Start, double End)> ranges,
        CancellationToken cancellationToken, double pauseMs);
    /// <summary>Decode the entire source file; used where the native player lacks the container's demuxer.</summary>
    Task<byte[]> CreateChapterAsync(string audio, CancellationToken cancellationToken);
}
