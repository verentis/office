using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Office.Harness;
using Office.Wopi;
using Xunit;

namespace Office.Protocol.Tests;

public sealed class WopiTests : IAsyncLifetime
{
    private readonly string directory = Path.Combine(Directory.GetCurrentDirectory(), "artifacts", "protocol", Guid.NewGuid().ToString("N"));
    private readonly TestClock clock = new();
    private SyntheticStore store = null!;
    private WebApplication app = null!;
    private HttpClient http = null!;
    private string file = "";
    private string token = "";
    private WopiSession session = null!;
    private string PathFor(string? credential = null, string tail = "") => $"/wopi/synthetic/main/files/{file}{tail}?access_token={credential ?? token}";

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(directory);
        store = new SyntheticStore(Path.Combine(directory, "test.sqlite"), clock);
        file = store.CreateFile("synthetic.docx", Encoding.UTF8.GetBytes("synthetic-original-bytes"));
        (token, session) = store.CreateSession(file);
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton<IWopiStore>(store);
        builder.Services.AddSingleton(new WopiOptions("https://office.localhost:8443"));
        app = builder.Build();
        app.MapPost("/sessions", () => Microsoft.AspNetCore.Http.Results.Json(LiveAdmission.Blocker, statusCode: 503));
        app.MapWopi();
        await app.StartAsync();
        http = app.GetTestClient();
    }
    public async Task DisposeAsync()
    {
        http.Dispose();
        await app.DisposeAsync();
        Directory.Delete(directory, true);
    }
    private Task<HttpResponseMessage> Post(string operation, string value = "lock", byte[]? body = null, string? credential = null, string? old = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, PathFor(credential, operation == "PUT" ? "/contents" : ""));
        request.Headers.Add("X-WOPI-Override", operation);
        request.Headers.Add("X-WOPI-Lock", value);
        if (old is not null) request.Headers.Add("X-WOPI-OldLock", old);
        if (body is not null) request.Content = new ByteArrayContent(body);
        return http.SendAsync(request);
    }

    [Fact]
    public async Task LiveAdmissionNeverIssuesCredentialOrDocument()
    {
        var response = await http.PostAsync("/sessions", new StringContent("{\"token\":\"untrusted-verentis-token\"}"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("platform_prerequisites_missing", body);
        Assert.DoesNotContain("access_token", body);
        Assert.DoesNotContain("untrusted-verentis-token", body);
        Assert.DoesNotContain("synthetic-original-bytes", body);
    }
    [Fact]
    public async Task CheckFileInfoAndGetFileAreScopedAndTruthful()
    {
        var info = await http.GetAsync(PathFor());
        Assert.Equal(HttpStatusCode.OK, info.StatusCode);
        var json = JsonDocument.Parse(await info.Content.ReadAsStringAsync()).RootElement;
        Assert.True(json.GetProperty("SupportsLocks").GetBoolean());
        Assert.False(json.GetProperty("SupportsRename").GetBoolean());
        Assert.Equal("1", json.GetProperty("Version").GetString());
        Assert.Equal("synthetic-original-bytes", await http.GetStringAsync(PathFor(tail: "/contents")));
    }
    [Theory]
    [InlineData("wrong-token")]
    [InlineData("workspace")]
    [InlineData("branch")]
    [InlineData("file")]
    [InlineData("duplicate-token")]
    public async Task InvalidScopesDoNotReturnContent(string kind)
    {
        var path = kind switch
        {
            "wrong-token" => PathFor(new string('x', 43), "/contents"),
            "workspace" => PathFor(tail: "/contents").Replace("/synthetic/", "/other/"),
            "branch" => PathFor(tail: "/contents").Replace("/main/", "/other/"),
            "file" => PathFor(tail: "/contents").Replace(file, new string('a', 32)),
            _ => PathFor(tail: "/contents") + "&access_token=" + token
        };
        var response = await http.GetAsync(path);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.DoesNotContain("synthetic-original-bytes", await response.Content.ReadAsStringAsync());
    }
    [Fact]
    public async Task ReadOnlyCannotMutateOrLock()
    {
        var (readToken, _) = store.CreateSession(file, true);
        var info = JsonDocument.Parse(await http.GetStringAsync(PathFor(readToken))).RootElement;
        Assert.False(info.GetProperty("UserCanWrite").GetBoolean());
        Assert.False(info.GetProperty("SupportsUpdate").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("LOCK", credential: readToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Post("PUT", body: [1], credential: readToken)).StatusCode);
        Assert.Equal(1, store.Read(session)!.Version);
    }
    [Fact]
    public async Task LockLifecycleRejectsMismatchAndSupportsRelock()
    {
        Assert.Equal(HttpStatusCode.OK, (await Post("LOCK")).StatusCode);
        var conflict = await Post("LOCK", "other");
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal("lock", conflict.Headers.GetValues("X-WOPI-Lock").Single());
        Assert.Equal(HttpStatusCode.Conflict, (await Post("REFRESH_LOCK", "other")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post("REFRESH_LOCK")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post("LOCK", "replacement", old: "lock")).StatusCode);
        Assert.Equal("replacement", (await Post("GET_LOCK")).Headers.GetValues("X-WOPI-Lock").Single());
        Assert.Equal(HttpStatusCode.Conflict, (await Post("UNLOCK")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Post("UNLOCK", "replacement")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Post("PUT", body: [1])).StatusCode);
    }
    [Theory]
    [InlineData("REFRESH_LOCK")]
    [InlineData("UNLOCK")]
    public async Task OldLockCannotAuthorizeAnotherOperation(string operation)
    {
        await Post("LOCK");
        Assert.Equal(HttpStatusCode.Conflict, (await Post(operation, "other", old: "lock")).StatusCode);
        Assert.Equal("lock", (await Post("GET_LOCK")).Headers.GetValues("X-WOPI-Lock").Single());
        Assert.Equal(HttpStatusCode.OK, (await Post(operation, "lock", old: "other")).StatusCode);
    }
    [Fact]
    public void InspectionDoesNotMintSessionsAndAdmissionPrunesExpiredSessions()
    {
        var path = Path.Combine(directory, "test.sqlite");
        using var db = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={path}");
        db.Open();
        using var count = db.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM sessions";
        for (var i = 0; i < 10; i++) Assert.NotNull(store.Inspect(file));
        Assert.Equal(1L, count.ExecuteScalar());
        clock.Advance(TimeSpan.FromSeconds(1800));
        store.CreateSession(file);
        Assert.Equal(1L, count.ExecuteScalar());
        Assert.Null(store.Authorize(token, session.Scope));
    }
    [Fact]
    public async Task SuccessfulSaveAdvancesRevisionAndSurvivesStoreRestart()
    {
        await Post("LOCK");
        var response = await Post("PUT", body: Encoding.UTF8.GetBytes("changed"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("2", response.Headers.GetValues("X-WOPI-ItemVersion").Single());
        var restarted = new SyntheticStore(Path.Combine(directory, "test.sqlite"), clock);
        var restored = restarted.Authorize(token, session.Scope)!;
        Assert.Equal(2, restored.Version);
        Assert.Equal("changed", Encoding.UTF8.GetString(restarted.Read(restored)!.Content));
        Assert.Equal("lock", restarted.Lock(restored, "GET_LOCK", "", null).Lock);
    }
    [Fact]
    public async Task ConcurrentSameRevisionHasExactlyOneWinner()
    {
        var (_, second) = store.CreateSession(file);
        var other = new SyntheticStore(Path.Combine(directory, "test.sqlite"), clock);
        await Post("LOCK");
        var tasks = new[] {
            Task.Run(() => store.Write(session, "lock", Encoding.UTF8.GetBytes("first"))),
            Task.Run(() => other.Write(second, "lock", Encoding.UTF8.GetBytes("second")))
        };
        var results = await Task.WhenAll(tasks);
        Assert.Equal(new[] { 200, 409 }, results.Select(r => r.Status).Order().ToArray());
        Assert.Equal(results[0].Status == 200 ? "first" : "second", Encoding.UTF8.GetString(store.Read(session)!.Content));
        Assert.Equal(2, store.Read(session)!.Version);
        Assert.Equal(409, (results[0].Status == 409 ? store.Write(session, "lock", [7]) : other.Write(second, "lock", [7])).Status);
        Assert.Equal(2, store.Read(session)!.Version);
    }
    [Fact]
    public void ConcurrentRequestsSharingOneCredentialCannotOverwriteAnAdmittedRevision()
    {
        store.Lock(session, "LOCK", "lock", null);
        Assert.Equal(200, store.Write(session, "lock", [1]).Status);
        Assert.Equal(409, store.Write(session, "lock", [2]).Status);
        var refreshedRequest = store.Authorize(token, session.Scope)!;
        Assert.Equal(200, store.Write(refreshedRequest, "lock", [3]).Status);
        Assert.Equal(new byte[] { 3 }, store.Read(refreshedRequest)!.Content);
    }
    [Fact]
    public async Task CompetingHttpWritersCannotSilentlyOverwrite()
    {
        var (secondToken, _) = store.CreateSession(file);
        await Post("LOCK");
        var responses = await Task.WhenAll(Post("PUT", body: [1]), Post("PUT", body: [2], credential: secondToken));
        Assert.Equal(new[] { 200, 409 }, responses.Select(r => (int)r.StatusCode).Order().ToArray());
        Assert.Equal(new byte[] { responses[0].IsSuccessStatusCode ? (byte)1 : (byte)2 }, store.Read(session)!.Content);
    }
    [Fact]
    public async Task ExpiredSessionStaysDeniedAfterRestart()
    {
        clock.Advance(TimeSpan.FromSeconds(1800));
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync(PathFor(tail: "/contents"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Post("PUT", body: [1])).StatusCode);
        var restarted = new SyntheticStore(Path.Combine(directory, "test.sqlite"), clock);
        Assert.Null(restarted.Authorize(token, session.Scope));
        Assert.Equal(401, restarted.Write(session, "lock", [2]).Status);
    }
    [Fact]
    public void LockExpiryDoesNotImplyAuthorizationRenewal()
    {
        var (_, longer) = store.CreateSession(file, lifetimeSeconds: 3600);
        Assert.Equal(200, store.Lock(longer, "LOCK", "old", null).Status);
        clock.Advance(TimeSpan.FromSeconds(1801));
        Assert.Equal(409, store.Write(longer, "old", [1]).Status);
        Assert.Equal(409, store.Lock(longer, "REFRESH_LOCK", "old", null).Status);
        Assert.Equal(200, store.Lock(longer, "LOCK", "new", null).Status);
        Assert.Null(store.Authorize(token, session.Scope));
    }
    [Fact]
    public async Task OversizedAndUnsupportedOperationsDoNotMutate()
    {
        await Post("LOCK");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await Post("PUT", body: new byte[WopiEndpoints.MaxFileBytes + 1])).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Post("LOCK", new string('x', 1025))).StatusCode);
        Assert.Equal(HttpStatusCode.NotImplemented, (await Post("RENAME_FILE")).StatusCode);
        Assert.Equal(1, store.Read(session)!.Version);
    }
    [Fact]
    public async Task StreamingWithoutContentLengthIsStillBounded()
    {
        await Post("LOCK");
        using var request = new HttpRequestMessage(HttpMethod.Post, PathFor(tail: "/contents")) { Content = new OversizedStreamContent() };
        request.Headers.Add("X-WOPI-Override", "PUT");
        request.Headers.Add("X-WOPI-Lock", "lock");
        var response = await http.SendAsync(request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal(1, store.Read(session)!.Version);
    }
    private sealed class OversizedStreamContent : HttpContent
    {
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            var chunk = new byte[64 * 1024];
            for (var count = 0; count < 257; count++) await stream.WriteAsync(chunk);
        }
    }
    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan span) => now += span;
    }
}
