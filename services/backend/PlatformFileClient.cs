using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Office.Wopi;

namespace Office.Backend;

public enum DelegationAuthMode { Legacy, OAuth }
public sealed record BackendIdentity(Guid ClientId, string ClientSecret, Uri PlatformOrigin,
    DelegationAuthMode AuthMode = DelegationAuthMode.OAuth);
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
    private readonly SemaphoreSlim tokenLock = new(1, 1);
    private ServiceTokenCache? cachedToken;

    public async Task<EmbedAdmission> ExchangeEmbed(string ticket, Uri editorOrigin, CancellationToken token)
    {
        if (string.IsNullOrWhiteSpace(ticket) || ticket.Length > 512)
            throw new PlatformFailure(401);
        using var response = await AuthorizedPost("app-embeds/exchange",
            backend.AuthMode == DelegationAuthMode.Legacy
                ? new { ticket, clientId = backend.ClientId, backend.ClientSecret }
                : (object)new { ticket, clientId = backend.ClientId }, token);
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
        return await CredentialRequest("exchange", backend.AuthMode == DelegationAuthMode.Legacy
            ? new { request.DelegationId, clientId = backend.ClientId, backend.ClientSecret,
                request.LaunchCredential }
            : (object)new { request.DelegationId, clientId = backend.ClientId, request.LaunchCredential }, token);
    }

    public Task<DelegatedCredentials> Renew(DelegatedCredentials credentials, Guid operation, CancellationToken token) =>
        CredentialRequest("renew", backend.AuthMode == DelegationAuthMode.Legacy
            ? new { credentials.DelegationId, clientId = backend.ClientId, backend.ClientSecret,
                credentials.RenewalCredential, operationId = operation }
            : (object)new { credentials.DelegationId, clientId = backend.ClientId,
                credentials.RenewalCredential, operationId = operation }, token);

    public async Task Revoke(DelegatedCredentials credentials, CancellationToken token)
    {
        using var response = await AuthorizedPost("app-delegations/revoke",
            backend.AuthMode == DelegationAuthMode.Legacy
                ? new { credentials.DelegationId, clientId = backend.ClientId, backend.ClientSecret,
                    credentials.RenewalCredential }
                : (object)new { credentials.DelegationId, clientId = backend.ClientId,
                    credentials.RenewalCredential }, token);
        RequireSuccess(response);
    }

    private async Task<DelegatedCredentials> CredentialRequest(string operation, object body, CancellationToken token)
    {
        using var response = await AuthorizedPost($"app-delegations/{operation}", body, token);
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

    private async Task<HttpResponseMessage> AuthorizedPost(string path, object body, CancellationToken token)
    {
        var uri = new Uri(backend.PlatformOrigin,
            $"v1/{(backend.AuthMode == DelegationAuthMode.Legacy ? "" : "hosted/")}{path}");
        if (backend.AuthMode == DelegationAuthMode.Legacy)
            return await http.PostAsJsonAsync(uri, body, token);
        var bearer = await ServiceToken(token);
        using var request = new HttpRequestMessage(HttpMethod.Post, uri)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        return await http.SendAsync(request, token);
    }

    private async Task<string> ServiceToken(CancellationToken token)
    {
        var cached = cachedToken;
        if (cached is not null && DateTimeOffset.UtcNow < cached.ExpiresAt)
            return cached.Value;
        await tokenLock.WaitAsync(token);
        try
        {
            cached = cachedToken;
            if (cached is not null && DateTimeOffset.UtcNow < cached.ExpiresAt)
                return cached.Value;
            cachedToken = null;
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(backend.PlatformOrigin, "connect/token"))
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials",
                    ["scope"] = "app-delegation"
                })
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic",
                Convert.ToBase64String(Encoding.UTF8.GetBytes($"{backend.ClientId:D}:{backend.ClientSecret}")));
            using var response = await http.SendAsync(request, token);
            if (!response.IsSuccessStatusCode) throw new PlatformFailure(503);
            var result = await response.Content.ReadFromJsonAsync<ServiceTokenResponse>(token);
            if (result is null || string.IsNullOrWhiteSpace(result.AccessToken) ||
                result.ExpiresIn <= 0 || result.TokenType is not (null or "Bearer"))
                throw new PlatformFailure(503);
            var lifetime = TimeSpan.FromSeconds(result.ExpiresIn);
            var margin = TimeSpan.FromSeconds(Math.Min(30, result.ExpiresIn / 10.0));
            cachedToken = new(result.AccessToken, DateTimeOffset.UtcNow.Add(lifetime - margin));
            return cachedToken.Value;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or NotSupportedException)
        {
            throw new PlatformFailure(503);
        }
        finally { tokenLock.Release(); }
    }

    private sealed record ServiceTokenResponse(
        [property: JsonPropertyName("access_token")] string? AccessToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("token_type")] string? TokenType);
    private sealed record ServiceTokenCache(string Value, DateTimeOffset ExpiresAt);

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
