using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Support;

/// <summary>
/// No-op dedication service for view-model tests that don't exercise
/// dedications — keeps the tests hermetic instead of letting the VM's
/// best-effort loader hit the real GraphQL endpoint in the background.
/// </summary>
public sealed class StubDedicationService : IDedicationService
{
    public static readonly StubDedicationService Instance = new();

    public List<DedicationContext> Contexts { get; } = [];

    public Task<List<Dedication>> GetDedicationsAsync(DedicationContext context, CancellationToken cancellationToken)
    {
        Contexts.Add(context);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new List<Dedication>());
    }
}
