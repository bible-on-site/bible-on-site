namespace BibleOnSite.Services;

/// <summary>
/// The signed-in user whose preferences sync (#1095). <see cref="UserId"/> is
/// the stable id that namespaces the remote document; null means no identity
/// is available and the app stays local-only. Implementations: Firebase Auth
/// (anonymous sign-in on Android/iOS) and <see cref="AnonymousUserIdentity"/>
/// elsewhere.
/// </summary>
public interface IUserIdentity
{
    /// <summary>Current user id, or null when not signed in.</summary>
    string? UserId { get; }

    /// <summary>True while <see cref="UserId"/> is non-null.</summary>
    bool IsSignedIn => UserId != null;

    /// <summary>
    /// Establishes an identity if none exists — anonymous Firebase sign-in on
    /// supported platforms; a no-op for the anonymous-only fallback.
    /// </summary>
    Task EnsureSignedInAsync(CancellationToken cancellationToken);

    /// <summary>Raised when <see cref="UserId"/> changes (sign-in/out).</summary>
    event EventHandler? UserChanged;
}

/// <summary>
/// Identity for platforms and builds without Firebase (Windows, MacCatalyst,
/// analytics-disabled Debug and e2e builds): never signed in, so preferences
/// stay local — the anonymous fallback the issue requires.
/// </summary>
public sealed class AnonymousUserIdentity : IUserIdentity
{
    public static readonly AnonymousUserIdentity Instance = new();

    private AnonymousUserIdentity() { }

    public string? UserId => null;

    public Task EnsureSignedInAsync(CancellationToken cancellationToken) => Task.CompletedTask;

#pragma warning disable CS0067 // Event is part of the IUserIdentity contract; the anonymous identity never signs in.
    public event EventHandler? UserChanged;
#pragma warning restore CS0067
}
