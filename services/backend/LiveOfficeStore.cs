using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;
using Office.Wopi;

namespace Office.Backend;

public sealed record OfficeSessionLaunch(string SessionId, string StatusCredential, string WopiCredential,
    FileScope Scope, string Name, bool ReadOnly, DateTimeOffset ExpiresAt);
public sealed record SaveCheckpoint(string Correlation, long Generation, string? Revision = null);
public sealed record OfficeSaveStatus(string Revision, long Sequence, string State, bool ReadOnly, SaveCheckpoint? Receipt);

/// <summary>
/// Durable coordination for one backend and one CODE instance. No file bytes
/// become authoritative here: only a successful conditional Node response commits.
/// </summary>
public sealed class LiveOfficeStore : IAsyncWopiStore, IDisposable
{
    private readonly string connectionString;
    private readonly IDataProtector protector;
    private readonly PlatformFileClient platform;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly FileStream ownership;

    public LiveOfficeStore(string directory, IDataProtectionProvider protection, PlatformFileClient platform)
    {
        Directory.CreateDirectory(directory);
        ownership = new FileStream(Path.Combine(directory, "backend.owner"), FileMode.OpenOrCreate,
            FileAccess.ReadWrite, FileShare.None);
        this.platform = platform;
        protector = protection.CreateProtector("office-live-state-v1");
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(directory, "office.db"), Pooling = false, DefaultTimeout = 15
        }.ToString();
        using var db = Open();
        using var command = db.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, wopi TEXT NOT NULL UNIQUE, status TEXT NOT NULL UNIQUE,
                document TEXT NOT NULL, expiry INTEGER NOT NULL, protected TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, protected TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS save_requests (
                session TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, document TEXT NOT NULL,
                generation INTEGER NOT NULL, expiry INTEGER NOT NULL, revision TEXT NULL);
            """;
        command.ExecuteNonQuery();
    }

    public async Task<OfficeSessionLaunch> Create(LaunchRequest request, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            var credentials = await platform.Exchange(request, token);
            if (credentials.DelegationId != request.DelegationId) throw new PlatformFailure(401);
            if (!string.Equals(credentials.ParentOrigin, request.ParentOrigin, StringComparison.Ordinal))
                throw new PlatformFailure(403);
            var file = await platform.Metadata(credentials, token);
            if (!Discovery.Formats.Contains(Path.GetExtension(file.Name).TrimStart('.').ToLowerInvariant()))
                throw new PlatformFailure(415);
            var documentId = Hash($"{credentials.AccountId:D}/{credentials.WorkspaceId:D}/{credentials.Branch}/{credentials.NodeId:D}");
            var scope = new FileScope(credentials.WorkspaceId.ToString("D"),
                Convert.ToHexString(Encoding.UTF8.GetBytes(credentials.Branch)), credentials.NodeId.ToString("D"));
            var wopi = Secret();
            var status = Secret();
            var session = new Session(Guid.NewGuid().ToString("N"), documentId, scope, credentials, file.Name);
            using var db = Open();
            using var tx = db.BeginTransaction();
            using var expired = Command(db, tx, "DELETE FROM sessions WHERE expiry<=$now", ("$now", Now));
            expired.ExecuteNonQuery();
            using var staleCheckpoints = Command(db, tx,
                "DELETE FROM save_requests WHERE session IN (SELECT session FROM save_requests WHERE expiry<=$now LIMIT 1000)", ("$now", Now));
            staleCheckpoints.ExecuteNonQuery();
            using var count = Command(db, tx, "SELECT COUNT(*) FROM sessions");
            if ((long)count.ExecuteScalar()! >= 10000) throw new PlatformFailure(503);
            var document = Load<Document>(db, tx, "documents", documentId);
            using var active = Command(db, tx, "SELECT COUNT(*) FROM sessions WHERE document=$id", ("$id", documentId));
            if (document is null || (long)active.ExecuteScalar()! == 0 && document.Pending is null)
            {
                document = new Document(file.Etag);
                Save(db, tx, "documents", documentId, document);
            }
            if (document.Revision != file.Etag || document.Pending is not null || document.State != "ready")
                throw new PlatformFailure(409);
            using var insert = Command(db, tx, "INSERT INTO sessions VALUES ($id,$wopi,$status,$doc,$expiry,$protected)",
                ("$id", session.Id), ("$wopi", Hash(wopi)), ("$status", Hash(status)), ("$doc", documentId),
                ("$expiry", credentials.AbsoluteExpiresAt.ToUnixTimeSeconds()),
                ("$protected", Protect(session)));
            insert.ExecuteNonQuery();
            tx.Commit();
            return new(session.Id, status, wopi, scope, file.Name, session.ReadOnly, credentials.AbsoluteExpiresAt);
        }
        finally { gate.Release(); }
    }

    public async Task<DocumentSession?> AuthorizeAsync(string token, FileScope scope, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken);
        try
        {
            using var db = Open();
            var session = Find(db, "wopi", Hash(token));
            if (session is null || session.Scope != scope) return null;
            session = await Refresh(session, cancellationToken);
            // Even lock/metadata operations must see live authority. No cached
            // platform authorization is inferred from a valid WOPI credential.
            await platform.Metadata(session.Credentials, cancellationToken);
            var document = Load<Document>(db, null, "documents", session.DocumentId)!;
            return new(Hash(token), scope, session.Credentials.UserId.ToString("D"),
                session.ReadOnly, session.Credentials.AbsoluteExpiresAt.ToUnixTimeSeconds(), document.Revision);
        }
        finally { gate.Release(); }
    }

    public async Task<string?> FramingOrigin(string credential, FileScope scope, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "wopi", Hash(credential));
            if (session is null || session.Scope != scope) return null;
            session = await Refresh(session, token);
            await platform.Metadata(session.Credentials, token);
            return session.Credentials.ParentOrigin;
        }
        finally { gate.Release(); }
    }

    public async Task<DocumentFile?> ReadAsync(DocumentSession authorized, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "wopi", authorized.TokenHash);
            if (session is null || session.Scope != authorized.Scope) return null;
            session = await Refresh(session, token);
            var document = await Recover(session, token);
            var file = await platform.Metadata(session.Credentials, token);
            var content = await platform.Read(session.Credentials, token);
            if (content.Revision != document.Revision || file.Etag != content.Revision)
                throw new PlatformFailure(409);
            return new(file.Name, content.Bytes, content.Revision);
        }
        finally { gate.Release(); }
    }

    public async Task<DocumentMutation> LockAsync(DocumentSession authorized, string operation, string value,
        string? oldValue, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "wopi", authorized.TokenHash);
            if (session is null || session.Scope != authorized.Scope) return new(401);
            if (session.ReadOnly) return new(403);
            session = await Refresh(session, token);
            await platform.Metadata(session.Credentials, token);
            var document = await Recover(session, token);
            var active = document.LockExpires > Now ? document.Lock : "";
            if (operation == "GET_LOCK") return new(200, active);
            if (value.Length is 0 or > 1024 || oldValue?.Length > 1024) return new(400);
            var expected = operation == "LOCK" ? oldValue ?? value : value;
            if (active.Length != 0 && active != expected ||
                (operation != "LOCK" || oldValue is not null) && active != expected)
                return new(409, active, "The document lock is unavailable.");
            if (operation is not ("LOCK" or "REFRESH_LOCK" or "UNLOCK")) return new(501);
            document.Lock = operation == "UNLOCK" ? "" : value;
            document.LockExpires = operation == "UNLOCK" ? 0 : Now + 1800;
            Save(db, null, "documents", session.DocumentId, document);
            return new(200);
        }
        finally { gate.Release(); }
    }

    public async Task<DocumentMutation> WriteAsync(DocumentSession authorized, string value, byte[] content,
        CancellationToken token, string? correlation = null)
    {
        await gate.WaitAsync(token);
        try
        {
            if (content.Length > WopiEndpoints.MaxFileBytes) return new(413);
            using var db = Open();
            var session = Find(db, "wopi", authorized.TokenHash);
            if (session is null || session.Scope != authorized.Scope) return new(401);
            if (session.ReadOnly) return new(403);
            session = await Refresh(session, token);
            var document = await Recover(session, token);
            var active = document.LockExpires > Now ? document.Lock : "";
            if (string.IsNullOrEmpty(value) || active != value)
                return new(409, active, "The document lock is missing or expired.");
            if (document.State != "ready") return new(409, active, "An external revision won. Preserve edits and reopen.");
            var contentHash = Convert.ToHexString(SHA256.HashData(content));
            // A retried identical callback after an ambiguous response reports its
            // existing receipt, not a second revision. Revalidate access first.
            if (document.LastHash == contentHash)
            {
                var latest = await platform.Metadata(session.Credentials, token);
                if (latest.Etag != document.Revision) return new(409, active, "An external revision won.");
                CompleteCheckpoint(db, null, session.DocumentId, correlation, document.Revision);
                return new(200, Revision: document.Revision);
            }
            document.Pending = new Pending(Guid.NewGuid(), session.Id, document.Revision, content, contentHash, correlation);
            Save(db, null, "documents", session.DocumentId, document);
            document = await Recover(session, token);
            return document.State == "ready"
                ? new(200, Revision: document.Revision)
                : new(409, active, "The conditional write was rejected. Preserve edits and reopen.");
        }
        finally { gate.Release(); }
    }

    public async Task<OfficeSaveStatus> Status(string id, string credential, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "status", Hash(credential));
            if (session?.Id != id) throw new PlatformFailure(401);
            session = await Refresh(session, token);
            var document = await Recover(session, token);
            var current = await platform.Metadata(session.Credentials, token);
            using var checkpoint = Command(db, null,
                "SELECT id, generation, revision FROM save_requests WHERE session=$session AND expiry>$now",
                ("$session", session.Id), ("$now", Now));
            using var reader = checkpoint.ExecuteReader();
            var receipt = reader.Read() && !reader.IsDBNull(2)
                ? new SaveCheckpoint(reader.GetString(0), reader.GetInt64(1), reader.GetString(2)) : null;
            return new(document.Revision, document.Sequence,
                current.Etag == document.Revision ? document.State : "conflict", session.ReadOnly, receipt);
        }
        finally { gate.Release(); }
    }

    public async Task<SaveCheckpoint> BeginSave(string id, string credential, long generation, CancellationToken token)
    {
        if (generation < 0 || generation > 9_007_199_254_740_991) throw new PlatformFailure(400);
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "status", Hash(credential));
            if (session?.Id != id || session.ReadOnly) throw new PlatformFailure(403);
            session = await Refresh(session, token);
            var document = await Recover(session, token);
            var metadata = await platform.Metadata(session.Credentials, token);
            if (document.State != "ready" || metadata.Etag != document.Revision) throw new PlatformFailure(409);
            var checkpoint = new SaveCheckpoint(Guid.NewGuid().ToString("N"), generation);
            using var command = Command(db, null, """
                INSERT INTO save_requests VALUES ($session,$id,$doc,$generation,$expiry,NULL)
                ON CONFLICT(session) DO UPDATE SET id=$id, generation=$generation, expiry=$expiry, revision=NULL
                """, ("$session", id), ("$id", checkpoint.Correlation), ("$doc", session.DocumentId),
                ("$generation", generation), ("$expiry", session.Credentials.AbsoluteExpiresAt.ToUnixTimeSeconds()));
            command.ExecuteNonQuery();
            return checkpoint;
        }
        finally { gate.Release(); }
    }

    public async Task Close(string id, string credential, CancellationToken token)
    {
        await gate.WaitAsync(token);
        try
        {
            using var db = Open();
            var session = Find(db, "status", Hash(credential));
            if (session?.Id != id) throw new PlatformFailure(401);
            session = await Refresh(session, token);
            var document = await Recover(session, token);
            if (document.Pending is not null && document.State != "conflict") throw new PlatformFailure(409);
            await platform.Revoke(session.Credentials, token);
            using var tx = db.BeginTransaction();
            if (document.State == "conflict" && document.Pending?.SessionId == session.Id)
            {
                document.Pending = null;
                Save(db, tx, "documents", session.DocumentId, document);
            }
            using var checkpoint = Command(db, tx, "DELETE FROM save_requests WHERE session=$id", ("$id", id));
            checkpoint.ExecuteNonQuery();
            using var delete = Command(db, tx, "DELETE FROM sessions WHERE id=$id", ("$id", id));
            delete.ExecuteNonQuery();
            tx.Commit();
        }
        finally { gate.Release(); }
    }

    private async Task<Session> Refresh(Session session, CancellationToken token)
    {
        if (session.Credentials.AbsoluteExpiresAt <= DateTimeOffset.UtcNow) throw new PlatformFailure(401);
        if (session.RenewalOperation is null && session.Credentials.AccessExpiresAt > DateTimeOffset.UtcNow.AddSeconds(30))
            return session;
        using var db = Open();
        session.RenewalOperation ??= Guid.NewGuid();
        Save(db, null, "sessions", session.Id, session);
        var previous = session.Credentials;
        var next = await platform.Renew(previous, session.RenewalOperation.Value, token);
        if (next.DelegationId != previous.DelegationId || next.AccountId != previous.AccountId ||
            next.UserId != previous.UserId || next.WorkspaceId != previous.WorkspaceId ||
            next.InstallationId != previous.InstallationId || next.NodeId != previous.NodeId ||
            next.Branch != previous.Branch || next.Writable != previous.Writable ||
            next.AbsoluteExpiresAt != previous.AbsoluteExpiresAt)
            throw new PlatformFailure(401);
        session.Credentials = next;
        session.RenewalOperation = null;
        Save(db, null, "sessions", session.Id, session);
        return session;
    }

    private async Task<Document> Recover(Session caller, CancellationToken token)
    {
        using var db = Open();
        var document = Load<Document>(db, null, "documents", caller.DocumentId) ?? throw new PlatformFailure(404);
        if (document.Pending is not { } pending) return document;
        var owner = Load<Session>(db, null, "sessions", pending.SessionId) ?? throw new PlatformFailure(409);
        owner = await Refresh(owner, token);
        try
        {
            var result = await platform.Write(owner.Credentials, pending.ExpectedRevision, pending.Operation, pending.Content, token);
            document.Revision = result.Etag;
            document.Sequence++;
            document.LastHash = pending.Hash;
            document.Pending = null;
            document.State = "ready";
            using var tx = db.BeginTransaction();
            Save(db, tx, "documents", caller.DocumentId, document);
            CompleteCheckpoint(db, tx, caller.DocumentId, pending.Correlation, document.Revision);
            tx.Commit();
        }
        catch (PlatformFailure failure) when (failure.Status is 409 or 412)
        {
            // Retain rejected bytes for explicit recovery; never rebase and retry
            // an old editor snapshot over the external winner.
            document.State = "conflict";
            Save(db, null, "documents", caller.DocumentId, document);
        }
        return document;
    }

    private static void CompleteCheckpoint(SqliteConnection db, SqliteTransaction? tx, string document,
        string? correlation, string revision)
    {
        if (correlation is null || !Guid.TryParseExact(correlation, "N", out _)) return;
        using var command = Command(db, tx, """
            UPDATE save_requests SET revision=$revision
            WHERE id=$id AND document=$doc AND expiry>$now AND revision IS NULL
            """, ("$revision", revision), ("$id", correlation), ("$doc", document), ("$now", Now));
        command.ExecuteNonQuery();
    }

    private Session? Find(SqliteConnection db, string credentialColumn, string hash)
    {
        using var command = Command(db, null,
            $"SELECT protected FROM sessions WHERE {credentialColumn}=$value AND expiry>$now", ("$value", hash), ("$now", Now));
        return command.ExecuteScalar() is string value ? Unprotect<Session>(value) : null;
    }
    private T? Load<T>(SqliteConnection db, SqliteTransaction? tx, string table, string id)
    {
        using var command = Command(db, tx, $"SELECT protected FROM {table} WHERE id=$id", ("$id", id));
        return command.ExecuteScalar() is string value ? Unprotect<T>(value) : default;
    }
    private void Save<T>(SqliteConnection db, SqliteTransaction? tx, string table, string id, T state)
    {
        using var command = Command(db, tx, table == "sessions"
                ? "UPDATE sessions SET protected=$value WHERE id=$id"
                : "INSERT INTO documents VALUES ($id,$value) ON CONFLICT(id) DO UPDATE SET protected=$value",
            ("$id", id), ("$value", Protect(state)));
        if (command.ExecuteNonQuery() != 1) throw new PlatformFailure(503);
    }
    private string Protect<T>(T value) => protector.Protect(JsonSerializer.Serialize(value));
    private T Unprotect<T>(string value) => JsonSerializer.Deserialize<T>(protector.Unprotect(value)) ?? throw new PlatformFailure(503);
    private SqliteConnection Open()
    {
        var db = new SqliteConnection(connectionString);
        db.Open();
        return db;
    }
    private static SqliteCommand Command(SqliteConnection db, SqliteTransaction? tx, string sql, params (string, object)[] values)
    {
        var command = db.CreateCommand();
        command.Transaction = tx;
        command.CommandText = sql;
        foreach (var (name, value) in values) command.Parameters.AddWithValue(name, value);
        return command;
    }
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    private static string Secret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public void Dispose() { ownership.Dispose(); gate.Dispose(); }

    public sealed class Session(string id, string documentId, FileScope scope, DelegatedCredentials credentials, string name)
    {
        public bool ReadOnly => !Credentials.Writable || !Discovery.CanEdit(Path.GetExtension(Name).TrimStart('.').ToLowerInvariant());
        public string Id { get; } = id;
        public string DocumentId { get; } = documentId;
        public FileScope Scope { get; } = scope;
        public string Name { get; } = name;
        public DelegatedCredentials Credentials { get; set; } = credentials;
        public Guid? RenewalOperation { get; set; }
    }
    public sealed class Document(string revision)
    {
        public string Revision { get; set; } = revision;
        public string Lock { get; set; } = "";
        public long LockExpires { get; set; }
        public long Sequence { get; set; }
        public string State { get; set; } = "ready";
        public string? LastHash { get; set; }
        public Pending? Pending { get; set; }
    }
    public sealed record Pending(Guid Operation, string SessionId, string ExpectedRevision, byte[] Content, string Hash, string? Correlation = null);
}
