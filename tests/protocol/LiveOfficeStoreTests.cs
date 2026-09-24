using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Office.Backend;
using Office.Wopi;
using Xunit;

namespace Office.Protocol.Tests;

/// <summary>Public-API adapter tests, not live platform or CODE acceptance.</summary>
public sealed class LiveOfficeStoreTests
{
    [Theory]
    [InlineData("letter.rtf", false)]
    [InlineData("data.csv", false)]
    [InlineData("data.tsv", false)]
    [InlineData("legacy.doc", false)]
    [InlineData("template.dot", true)]
    [InlineData("template.pot", true)]
    [InlineData("drawing.vsdx", true)]
    [InlineData("drawing.otg", true)]
    public async Task Format_policy_is_enforced_independently_of_the_delegated_write_scope(string name, bool readOnly)
    {
        using var fixture = new Fixture();
        fixture.Api.Name = name;
        using var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        Assert.Equal(readOnly, launch.ReadOnly);
        var session = (await store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        Assert.Equal(readOnly, session.ReadOnly);
        Assert.Equal(readOnly, (await store.Status(launch.SessionId, launch.StatusCredential, default)).ReadOnly);
        if (readOnly)
        {
            Assert.Equal(403, (await store.WriteAsync(session, "", [1], default)).Status);
            Assert.Equal(403, (await store.LockAsync(session, "LOCK", "lock", null, default)).Status);
            Assert.Equal(403, (await Assert.ThrowsAsync<PlatformFailure>(() => store.BeginSave(launch.SessionId, launch.StatusCredential, 1, default))).Status);
        }
    }

    [Fact]
    public async Task Lost_write_response_recovers_original_operation_after_backend_restart()
    {
        using var fixture = new Fixture();
        var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        var session = (await store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        Assert.Equal(200, (await store.LockAsync(session, "LOCK", "shared", null, default)).Status);
        var checkpoint = await store.BeginSave(launch.SessionId, launch.StatusCredential, 7, default);
        fixture.Api.LoseWriteResponse = true;
        await Assert.ThrowsAsync<HttpRequestException>(() => store.WriteAsync(session, "shared", [4, 5, 6], default, checkpoint.Correlation));
        Assert.Equal(1, fixture.Api.Commits);
        store.Dispose();
        using var restarted = fixture.Start();
        var status = await restarted.Status(launch.SessionId, launch.StatusCredential, default);
        Assert.Equal("ready", status.State);
        Assert.Equal("opaque-2", status.Revision);
        Assert.Equal(1, status.Sequence);
        Assert.Equal(checkpoint.Correlation, status.Receipt!.Correlation);
        Assert.Equal(7, status.Receipt.Generation);
        Assert.Equal(status.Revision, status.Receipt.Revision);
        Assert.Equal(1, fixture.Api.Commits);
        Assert.Equal(2, fixture.Api.WriteCalls);
        var resumed = (await restarted.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        Assert.Equal(new byte[] { 4, 5, 6 }, (await restarted.ReadAsync(resumed, default))!.Content);
        Assert.Equal("shared", (await restarted.LockAsync(resumed, "GET_LOCK", "", null, default)).Lock);
        Assert.Equal(200, (await restarted.WriteAsync(resumed, "shared", [4, 5, 6], default)).Status);
        Assert.Equal(1, fixture.Api.Commits);
    }

    [Fact]
    public async Task Replaced_or_unrelated_save_callbacks_cannot_acknowledge_a_newer_checkpoint()
    {
        using var fixture = new Fixture();
        using var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        var session = (await store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        await store.LockAsync(session, "LOCK", "shared", null, default);
        var first = await store.BeginSave(launch.SessionId, launch.StatusCredential, 1, default);
        var latest = await store.BeginSave(launch.SessionId, launch.StatusCredential, 2, default);
        await store.WriteAsync(session, "shared", [5], default, first.Correlation);
        Assert.Null((await store.Status(launch.SessionId, launch.StatusCredential, default)).Receipt);
        await store.WriteAsync(session, "shared", [5], default, Guid.NewGuid().ToString("N"));
        Assert.Null((await store.Status(launch.SessionId, launch.StatusCredential, default)).Receipt);
        await store.WriteAsync(session, "shared", [5], default, latest.Correlation);
        var result = await store.Status(launch.SessionId, launch.StatusCredential, default);
        Assert.Equal(latest.Correlation, result.Receipt!.Correlation);
        Assert.Equal(2, result.Receipt.Generation);
        Assert.Equal(1, fixture.Api.Commits);
    }

    [Fact]
    public async Task Shared_document_callback_confirms_only_the_requesting_sessions_checkpoint()
    {
        using var fixture = new Fixture();
        using var store = fixture.Start();
        var first = await store.Create(fixture.Request(), default);
        var firstSession = (await store.AuthorizeAsync(first.WopiCredential, first.Scope, default))!;
        await store.LockAsync(firstSession, "LOCK", "shared", null, default);
        var firstCheckpoint = await store.BeginSave(first.SessionId, first.StatusCredential, 7, default);

        fixture.Api.User = Guid.NewGuid();
        var second = await store.Create(fixture.Request(), default);
        var secondSession = (await store.AuthorizeAsync(second.WopiCredential, second.Scope, default))!;
        Assert.NotEqual(firstSession.User, secondSession.User);
        var secondCheckpoint = await store.BeginSave(second.SessionId, second.StatusCredential, 11, default);

        // CODE may save a shared document through another collaborator's WOPI session.
        Assert.Equal(200, (await store.WriteAsync(secondSession, "shared", [4, 5], default,
            firstCheckpoint.Correlation)).Status);
        var firstStatus = await store.Status(first.SessionId, first.StatusCredential, default);
        Assert.Equal(firstCheckpoint.Correlation, firstStatus.Receipt!.Correlation);
        Assert.Equal(7, firstStatus.Receipt.Generation);
        Assert.Null((await store.Status(second.SessionId, second.StatusCredential, default)).Receipt);

        Assert.Equal(200, (await store.WriteAsync(firstSession, "shared", [4, 5], default,
            secondCheckpoint.Correlation)).Status);
        var secondStatus = await store.Status(second.SessionId, second.StatusCredential, default);
        Assert.Equal(secondCheckpoint.Correlation, secondStatus.Receipt!.Correlation);
        Assert.Equal(11, secondStatus.Receipt.Generation);
        Assert.Equal(firstStatus.Revision, secondStatus.Receipt.Revision);
        Assert.Equal(1, fixture.Api.Commits);
    }

    [Fact]
    public async Task External_writer_wins_without_rebasing_the_old_editor_snapshot()
    {
        using var fixture = new Fixture();
        using var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        var session = (await store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        await store.LockAsync(session, "LOCK", "shared", null, default);
        fixture.Api.Revision = "external-winner";
        fixture.Api.Content = [9, 9];
        var result = await store.WriteAsync(session, "shared", [1, 2], default);
        Assert.Equal(409, result.Status);
        Assert.Equal("external-winner", fixture.Api.Revision);
        Assert.Equal(new byte[] { 9, 9 }, fixture.Api.Content);
        Assert.Equal(0, fixture.Api.Commits);
        Assert.Equal("conflict", (await store.Status(launch.SessionId, launch.StatusCredential, default)).State);
    }

    [Fact]
    public async Task Live_revocation_and_file_scope_are_rechecked_even_for_wopi_locks()
    {
        using var fixture = new Fixture();
        using var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        Assert.Null(await store.AuthorizeAsync(launch.WopiCredential, launch.Scope with { File = "other" }, default));
        var session = (await store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default))!;
        fixture.Api.Revoked = true;
        var denied = await Assert.ThrowsAsync<PlatformFailure>(() => store.LockAsync(session, "LOCK", "lock", null, default));
        Assert.Equal(401, denied.Status);
        await Assert.ThrowsAsync<PlatformFailure>(() => store.ReadAsync(session, default));
        await Assert.ThrowsAsync<PlatformFailure>(() => store.Status(launch.SessionId, "wrong", default));
    }

    [Fact]
    public async Task Read_only_mode_and_shared_document_locks_are_server_enforced()
    {
        using var fixture = new Fixture();
        using var store = fixture.Start();
        var first = await store.Create(fixture.Request(), default);
        var firstSession = (await store.AuthorizeAsync(first.WopiCredential, first.Scope, default))!;
        await store.LockAsync(firstSession, "LOCK", "shared", null, default);
        fixture.Api.User = Guid.NewGuid();
        var second = await store.Create(fixture.Request(), default);
        var secondSession = (await store.AuthorizeAsync(second.WopiCredential, second.Scope, default))!;
        Assert.NotEqual(firstSession.User, secondSession.User);
        Assert.Equal(200, (await store.LockAsync(secondSession, "LOCK", "shared", null, default)).Status);
        Assert.Equal(409, (await store.LockAsync(secondSession, "LOCK", "independent", null, default)).Status);
        fixture.Api.Writable = false;
        var readOnly = await store.Create(fixture.Request(), default);
        var readSession = (await store.AuthorizeAsync(readOnly.WopiCredential, readOnly.Scope, default))!;
        Assert.Equal(403, (await store.WriteAsync(readSession, "shared", [1], default)).Status);
        Assert.Equal(403, (await store.LockAsync(readSession, "LOCK", "shared", null, default)).Status);
    }

    [Fact]
    public async Task Lost_renewal_response_replays_persisted_operation_and_secrets_are_encrypted()
    {
        using var fixture = new Fixture();
        fixture.Api.AccessExpiry = DateTimeOffset.UtcNow.AddSeconds(10);
        var store = fixture.Start();
        var launch = await store.Create(fixture.Request(), default);
        fixture.Api.LoseRenewalResponse = true;
        await Assert.ThrowsAsync<HttpRequestException>(() => store.AuthorizeAsync(launch.WopiCredential, launch.Scope, default));
        store.Dispose();
        using var restarted = fixture.Start();
        Assert.NotNull(await restarted.AuthorizeAsync(launch.WopiCredential, launch.Scope, default));
        Assert.Equal(2, fixture.Api.RenewalCalls);
        Assert.Single(fixture.Api.Renewals);
        foreach (var path in Directory.EnumerateFiles(fixture.Directory, "office.db*"))
        {
            var data = Encoding.UTF8.GetString(await File.ReadAllBytesAsync(path));
            Assert.DoesNotContain("private-renewal-", data);
            Assert.DoesNotContain(launch.WopiCredential, data);
            Assert.DoesNotContain(launch.StatusCredential, data);
        }
        Assert.Throws<IOException>(() => fixture.Start());
    }

    private sealed class Fixture : IDisposable
    {
        public string Directory { get; } = Path.Combine(Path.GetTempPath(), $"office-live-tests-{Guid.NewGuid():N}");
        public MockPlatform Api { get; } = new();
        private readonly HttpClient http;
        public Fixture() { System.IO.Directory.CreateDirectory(Directory); http = new HttpClient(Api); }
        public LiveOfficeStore Start() => new(Directory,
            DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(Directory, "keys"))),
            new PlatformFileClient(http, new(Api.Client, "private-client-secret", new Uri("https://api.example/"))));
        public Office.Backend.LaunchRequest Request() => new(Guid.NewGuid(), Api.Client, "single-use-launch");
        public void Dispose() { http.Dispose(); System.IO.Directory.Delete(Directory, true); }
    }

    private sealed class MockPlatform : HttpMessageHandler
    {
        public Guid Client { get; } = Guid.NewGuid();
        public Guid User { get; set; } = Guid.NewGuid();
        private Guid Account { get; } = Guid.NewGuid();
        private Guid Workspace { get; } = Guid.NewGuid();
        private Guid Node { get; } = Guid.NewGuid();
        private Guid Installation { get; } = Guid.NewGuid();
        public bool Writable { get; set; } = true;
        public bool Revoked { get; set; }
        public bool LoseWriteResponse { get; set; }
        public bool LoseRenewalResponse { get; set; }
        public DateTimeOffset AccessExpiry { get; set; } = DateTimeOffset.UtcNow.AddMinutes(5);
        private DateTimeOffset AbsoluteExpiry { get; } = DateTimeOffset.UtcNow.AddHours(8);
        public string Revision { get; set; } = "opaque-initial";
        public byte[] Content { get; set; } = [1, 2, 3];
        public int Commits { get; private set; }
        public int WriteCalls { get; private set; }
        public int RenewalCalls { get; private set; }
        private readonly Dictionary<string, PlatformFile> writes = [];
        public Dictionary<Guid, DelegatedCredentials> Renewals { get; } = [];
        public string Name { get; set; } = "original.xlsx";
        private PlatformFile Metadata => new(Node, Name, $"/{Name}",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Revision, Content.Length);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (Revoked) return new(HttpStatusCode.Unauthorized);
            if (request.RequestUri!.AbsolutePath.Contains("app-delegations"))
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
                var id = body.RootElement.GetProperty("delegationId").GetGuid();
                var credentials = new DelegatedCredentials(id, Account, User, Workspace, Installation, Node,
                    "main", Writable, "vda1.encrypted-access", AccessExpiry, "private-renewal-original", AbsoluteExpiry);
                if (request.RequestUri.AbsolutePath.EndsWith("/renew"))
                {
                    RenewalCalls++;
                    var operation = body.RootElement.GetProperty("operationId").GetGuid();
                    if (!Renewals.TryGetValue(operation, out credentials))
                    {
                        credentials = new(id, Account, User, Workspace, Installation, Node, "main", Writable,
                            "vda1.renewed-access", DateTimeOffset.UtcNow.AddMinutes(5), "private-renewal-next", AbsoluteExpiry);
                        Renewals.Add(operation, credentials);
                    }
                    if (LoseRenewalResponse) { LoseRenewalResponse = false; throw new HttpRequestException("Lost response."); }
                }
                return Json(credentials);
            }
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.StartsWith("vda1.", request.Headers.Authorization!.Parameter);
            Assert.Equal("main", request.Headers.GetValues("X-Branch").Single());
            if (request.Method == HttpMethod.Put)
            {
                WriteCalls++;
                var key = request.Headers.GetValues("Idempotency-Key").Single();
                if (writes.TryGetValue(key, out var previous)) return Json(previous);
                if (request.Headers.IfMatch.Single().Tag != $"\"{Revision}\"")
                    return new(HttpStatusCode.PreconditionFailed);
                Content = await request.Content!.ReadAsByteArrayAsync(cancellationToken);
                Revision = $"opaque-{++Commits + 1}";
                writes.Add(key, Metadata);
                if (LoseWriteResponse) { LoseWriteResponse = false; throw new HttpRequestException("Lost response."); }
                return Json(Metadata);
            }
            if (request.RequestUri.AbsolutePath.EndsWith("/file")) return Json(Metadata);
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Content) };
            response.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue($"\"{Revision}\"");
            return response;
        }
        private static HttpResponseMessage Json(object value) => new(HttpStatusCode.OK) { Content = JsonContent.Create(value) };
    }
}
