using BibleOnSite.Models;
using GraphQL.Client.Http;

namespace BibleOnSite.Services;

/// <summary>Dedication reads for reader surfaces (#2731).</summary>
public interface IDedicationService
{
    /// <summary>Active dedications applicable to the given reading context.</summary>
    Task<List<Dedication>> GetDedicationsAsync(DedicationContext context, CancellationToken cancellationToken);
}

/// <summary>
/// Resolves dedications through the API's `dedications(context:)` query — the
/// same applicability contract the website applies (direct scopes plus
/// perek → sefer → helek ancestors, expired rows excluded server-side).
/// </summary>
public class DedicationService : BaseGraphQLService, IDedicationService
{
    private static readonly Lazy<DedicationService> _instance = new(() => new DedicationService());

    /// <summary>Singleton instance of the DedicationService.</summary>
    public static DedicationService Instance => _instance.Value;

    private DedicationService()
    {
    }

    public DedicationService(GraphQLHttpClient client) : base(client)
    {
    }

    /// <inheritdoc />
    public async Task<List<Dedication>> GetDedicationsAsync(DedicationContext context, CancellationToken cancellationToken)
    {
        var data = await QueryAsync<DedicationsResponse>(@"
            query Dedications($context: DedicationContextInput!) {
                dedications(context: $context) {
                    id
                    subject
                    purposes
                    expiresAt
                    scopes {
                        kind
                        perekIdLow
                        perekIdHigh
                        seferId
                        helekId
                        parashaId
                        articleId
                        entryId
                        expiresAt
                    }
                }
            }",
            "Dedications",
            new Dictionary<string, object?> { ["context"] = context },
            cancellationToken);

        return data?.Dedications?.Select(dto => new Dedication
        {
            Id = dto.Id,
            Subject = dto.Subject ?? string.Empty,
            Purposes = dto.Purposes ?? [],
            ExpiresAt = dto.ExpiresAt,
            Scopes = (dto.Scopes ?? []).Select(s => new DedicationScope
            {
                Kind = s.Kind ?? string.Empty,
                PerekIdLow = s.PerekIdLow,
                PerekIdHigh = s.PerekIdHigh,
                SeferId = s.SeferId,
                HelekId = s.HelekId,
                ParashaId = s.ParashaId,
                ArticleId = s.ArticleId,
                EntryId = s.EntryId,
                ExpiresAt = s.ExpiresAt,
            }).ToList(),
        }).ToList() ?? [];
    }

    /// <summary>Response shape for the `dedications` query.</summary>
    public sealed class DedicationsResponse
    {
        public List<DedicationDto>? Dedications { get; set; }
    }

    public sealed class DedicationDto
    {
        public int Id { get; set; }
        public string? Subject { get; set; }
        public List<string>? Purposes { get; set; }
        public string? ExpiresAt { get; set; }
        public List<ScopeDto>? Scopes { get; set; }
    }

    public sealed class ScopeDto
    {
        public string? Kind { get; set; }
        public int? PerekIdLow { get; set; }
        public int? PerekIdHigh { get; set; }
        public int? SeferId { get; set; }
        public int? HelekId { get; set; }
        public int? ParashaId { get; set; }
        public int? ArticleId { get; set; }
        public string? EntryId { get; set; }
        public string? ExpiresAt { get; set; }
    }
}
