using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Office.Wopi;

namespace Office.Backend;

public sealed record BackendIdentity(Guid ClientId, string ClientSecret, Uri PlatformOrigin);
public sealed record LaunchRequest(Guid DelegationId, Guid BackendClientId, string LaunchCredential,
    string ParentOrigin);
public sealed record DelegatedCredentials(Guid DelegationId, Guid AccountId, Guid UserId, Guid WorkspaceId,
    Guid InstallationId, Guid NodeId, string Branch, bool Writable, string AccessToken,
    DateTimeOffset AccessExpiresAt, string RenewalCredential, DateTimeOffset AbsoluteExpiresAt,
    string ParentOrigin);
public sealed record PlatformFile(Guid NodeId, string Name, string Path, string MimeType, string Etag, long? Size);
public sealed record PlatformContent(byte[] Bytes, string Revision);
public sealed record EmbedAdmission(Guid WorkspaceId, Guid InstallationId, string ParentOrigin, string EntryUrl);

public sealed class PlatformFailure(int status) : Exception("The authorized platform operation failed.")
{
    public int Status { get; } = status;
}

/// <summary>Uses only public delegation and stable-node APIs; never follows download redirects.</summary>
public sealed class PlatformFileClient(HttpClient http, BackendIdentity backend)
{
    public async Task<EmbedAdmission> ExchangeEmbed(string ticket, Uri editorOrigin, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(ticket) || ticket.Length > 512)
            throw new PlatformFailure(401);
        using var response = await http.PostAsJsonAsync(new Uri(backend.PlatformOrigin, "v1/app-embeds/exchange"),
            new { ticket, clientId = backend.ClientId, backend.ClientSecret }, token);
        RequireSuccess(response);
        var admission = await response.Content.ReadFromJsonAsync<EmbedAdmission>(token);
        if (admission is null || admission.WorkspaceId == Guid.Empty || admission.InstallationId == Guid.Empty ||
            !IsExactHttpsOrigin(admission.ParentOrigin) ||
            !Uri.TryCreate(admission.EntryUrl, UriKind.Absolute, out var entry) ||
            entry.GetLeftPart(UriPartial.Authority) != editorOrigin.GetLeftPart(UriPartial.Authority) ||
            entry.AbsolutePath != "/" || entry.Query.Length != 0 || entry.Fragment.Length != 0)
            throw new PlatformFailure(502);
        return admission;
    }

    public async Task<DelegatedCredentials> Exchange(LaunchRequest request, CancellationToken token)
    {
        if (request.BackendClientId != backend.ClientId || request.DelegationId == Guid.Empty ||
            string.IsNullOrWhiteSpace(request.LaunchCredential) || request.LaunchCredential.Length > 512 ||
            !IsExactHttpsOrigin(request.ParentOrigin))
            throw new PlatformFailure(401);
        return await CredentialRequest("exchange", new
        {
            request.DelegationId, clientId = backend.ClientId, backend.ClientSecret, request.LaunchCredential
        }, token);
    }

    public Task<DelegatedCredentials> Renew(DelegatedCredentials credentials, Guid operation, CancellationToken token) =>
        CredentialRequest("renew", new
        {
            credentials.DelegationId, clientId = backend.ClientId, backend.ClientSecret,
            credentials.RenewalCredential, operationId = operation
        }, token);

    public async Task Revoke(DelegatedCredentials credentials, CancellationToken token)
    {
        using var response = await http.PostAsJsonAsync(new Uri(backend.PlatformOrigin, "v1/app-delegations/revoke"),
            new { credentials.DelegationId, clientId = backend.ClientId, backend.ClientSecret, credentials.RenewalCredential }, token);
        RequireSuccess(response);
    }

    private async Task<DelegatedCredentials> CredentialRequest(string operation, object body, CancellationToken token)
    {
        using var response = await http.PostAsJsonAsync(new Uri(backend.PlatformOrigin, $"v1/app-delegations/{operation}"), body, token);
        RequireSuccess(response);
        var value = await response.Content.ReadFromJsonAsync<DelegatedCredentials>(token);
        if (value is null || value.DelegationId == Guid.Empty || value.AccountId == Guid.Empty ||
            value.UserId == Guid.Empty || value.WorkspaceId == Guid.Empty || value.InstallationId == Guid.Empty ||
            value.NodeId == Guid.Empty || string.IsNullOrWhiteSpace(value.Branch) || value.Branch.Length > 256 ||
            value.AccessToken?.StartsWith("vda1.", StringComparison.Ordinal) != true ||
            string.IsNullOrWhiteSpace(value.RenewalCredential) || value.AbsoluteExpiresAt <= DateTimeOffset.UtcNow ||
            !IsExactHttpsOrigin(value.ParentOrigin))
            throw new PlatformFailure(502);
        return value;
    }

    private static bool IsExactHttpsOrigin(string? value) =>
        value is { Length: > 0 and <= 256 } &&
        Uri.TryCreate(value, UriKind.Absolute, out var origin) &&
        origin.Scheme == Uri.UriSchemeHttps &&
        !string.IsNullOrEmpty(origin.Host) &&
        origin.UserInfo.Length == 0 &&
        value == origin.GetLeftPart(UriPartial.Authority);

    public async Task<PlatformFile> Metadata(DelegatedCredentials credentials, CancellationToken token)
    {
        using var request = Request(credentials, HttpMethod.Get, "file");
        using var response = await http.SendAsync(request, token);
        RequireSuccess(response);
        return Validate(await response.Content.ReadFromJsonAsync<PlatformFile>(token), credentials.NodeId);
    }

    public async Task<PlatformContent> Read(DelegatedCredentials credentials, CancellationToken token)
    {
        using var request = Request(credentials, HttpMethod.Get, "content");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token);
        RequireSuccess(response);
        if (response.Content.Headers.ContentLength > WopiEndpoints.MaxFileBytes) throw new PlatformFailure(413);
        var revision = response.Headers.ETag;
        if (revision is null || revision.IsWeak) throw new PlatformFailure(502);
        using var buffer = new MemoryStream();
        await using var input = await response.Content.ReadAsStreamAsync(token);
        var chunk = new byte[64 * 1024];
        int length;
        while ((length = await input.ReadAsync(chunk, token)) != 0)
        {
            if (buffer.Length + length > WopiEndpoints.MaxFileBytes) throw new PlatformFailure(413);
            buffer.Write(chunk, 0, length);
        }
        return new(buffer.ToArray(), revision.Tag.Trim('"'));
    }

    public async Task<PlatformFile> Write(DelegatedCredentials credentials, string revision, Guid operation,
        byte[] bytes, CancellationToken token)
    {
        if (bytes.Length > WopiEndpoints.MaxFileBytes) throw new PlatformFailure(413);
        using var request = Request(credentials, HttpMethod.Put, "content");
        request.Headers.IfMatch.Add(new EntityTagHeaderValue(JsonSerializer.Serialize(revision)));
        request.Headers.Add("Idempotency-Key", operation.ToString("D"));
        request.Content = new ByteArrayContent(bytes);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var response = await http.SendAsync(request, token);
        RequireSuccess(response);
        return Validate(await response.Content.ReadFromJsonAsync<PlatformFile>(token), credentials.NodeId);
    }

    private HttpRequestMessage Request(DelegatedCredentials credentials, HttpMethod method, string operation)
    {
        var request = new HttpRequestMessage(method, new Uri(backend.PlatformOrigin, $"v1/nodes/{credentials.NodeId:D}/{operation}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.AccessToken);
        request.Headers.Add("X-Branch", credentials.Branch);
        request.Headers.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
        return request;
    }

    private static PlatformFile Validate(PlatformFile? file, Guid nodeId) =>
        file is not null && file.NodeId == nodeId && !string.IsNullOrWhiteSpace(file.Etag) &&
        !string.IsNullOrWhiteSpace(file.Name) && file.Size is >= 0 and <= WopiEndpoints.MaxFileBytes
            ? file : throw new PlatformFailure(502);

    private static void RequireSuccess(HttpResponseMessage response)
    {
        if (!response.IsSuccessStatusCode)
            throw new PlatformFailure((int)response.StatusCode);
    }
}
