using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Office.Wopi;

namespace Office.Harness;

public sealed class SyntheticStore : IWopiStore
{
    private readonly string connectionString;
    private readonly TimeProvider clock;
    public SyntheticStore(string path, TimeProvider? clock = null)
    {
        this.clock = clock ?? TimeProvider.System;
        connectionString = new SqliteConnectionStringBuilder { DataSource = path, DefaultTimeout = 15, Pooling = false }.ToString();
        using var db = Open();
        using var command = db.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY, workspace TEXT NOT NULL, branch TEXT NOT NULL, name TEXT NOT NULL,
                content BLOB NOT NULL, version INTEGER NOT NULL, lock TEXT NOT NULL DEFAULT '', lock_expiry INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS versions (file TEXT NOT NULL, version INTEGER NOT NULL, content BLOB NOT NULL, PRIMARY KEY(file, version));
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, file TEXT NOT NULL, workspace TEXT NOT NULL, branch TEXT NOT NULL,
                user TEXT NOT NULL, readonly INTEGER NOT NULL, expiry INTEGER NOT NULL, version INTEGER NOT NULL);
            """;
        command.ExecuteNonQuery();
    }

    private long Now => clock.GetUtcNow().ToUnixTimeSeconds();
    private SqliteConnection Open()
    {
        var db = new SqliteConnection(connectionString);
        db.Open();
        return db;
    }
    private static SqliteCommand Command(SqliteConnection db, SqliteTransaction? tx, string sql, params (string, object)[] parameters)
    {
        var command = db.CreateCommand();
        command.Transaction = tx;
        command.CommandText = sql;
        foreach (var (key, value) in parameters) command.Parameters.AddWithValue(key, value);
        return command;
    }
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public string CreateFile(string name, byte[] content)
    {
        if (content.Length > WopiEndpoints.MaxFileBytes) throw new ArgumentException("Fixture too large.");
        var id = Guid.NewGuid().ToString("N");
        using var db = Open();
        using var tx = db.BeginTransaction();
        using var insert = Command(db, tx, "INSERT INTO files(id, workspace, branch, name, content, version) VALUES ($id, 'synthetic', 'main', $name, $content, 1)",
            ("$id", id), ("$name", name), ("$content", content));
        insert.ExecuteNonQuery();
        using var history = Command(db, tx, "INSERT INTO versions VALUES($id, 1, $content)", ("$id", id), ("$content", content));
        history.ExecuteNonQuery();
        tx.Commit();
        return id;
    }
    public (string Token, WopiSession Session) CreateSession(string file, bool readOnly = false, int lifetimeSeconds = 1800)
    {
        if (lifetimeSeconds is < 1 or > 3600) throw new ArgumentOutOfRangeException(nameof(lifetimeSeconds));
        using var db = Open();
        using var tx = db.BeginTransaction();
        using var cleanup = Command(db, tx, "DELETE FROM sessions WHERE token IN (SELECT token FROM sessions WHERE expiry<=$now LIMIT 1000)", ("$now", Now));
        cleanup.ExecuteNonQuery();
        using var select = Command(db, tx, "SELECT version FROM files WHERE id=$id AND workspace='synthetic' AND branch='main'", ("$id", file));
        var version = select.ExecuteScalar() as long? ?? throw new KeyNotFoundException();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var session = new WopiSession(Hash(token), new("synthetic", "main", file), "synthetic-user", readOnly, Now + lifetimeSeconds, version);
        using var insert = Command(db, tx, "INSERT INTO sessions VALUES($token, $file, 'synthetic', 'main', $user, $ro, $expiry, $version)",
            ("$token", session.TokenHash), ("$file", file), ("$user", session.User), ("$ro", readOnly), ("$expiry", session.ExpiresAt), ("$version", version));
        insert.ExecuteNonQuery();
        tx.Commit();
        return (token, session);
    }
    public WopiSession? Authorize(string token, FileScope scope)
    {
        using var db = Open();
        return Lookup(db, null, Hash(token), scope);
    }
    private WopiSession? Lookup(SqliteConnection db, SqliteTransaction? tx, string hash, FileScope scope)
    {
        using var command = Command(db, tx, """
            SELECT user, readonly, expiry, version FROM sessions
            WHERE token=$token AND file=$file AND workspace=$workspace AND branch=$branch AND expiry>$now
            """, ("$token", hash), ("$file", scope.File), ("$workspace", scope.Workspace), ("$branch", scope.Branch), ("$now", Now));
        using var reader = command.ExecuteReader();
        return reader.Read() ? new(hash, scope, reader.GetString(0), reader.GetBoolean(1), reader.GetInt64(2), reader.GetInt64(3)) : null;
    }
    public WopiFile? Read(WopiSession session)
    {
        using var db = Open();
        using var tx = db.BeginTransaction();
        if (Lookup(db, tx, session.TokenHash, session.Scope) is null) return null;
        using var query = Command(db, tx, "SELECT name, content, version FROM files WHERE id=$id", ("$id", session.Scope.File));
        using var reader = query.ExecuteReader();
        return reader.Read() ? new(reader.GetString(0), (byte[])reader[1], reader.GetInt64(2)) : null;
    }
    public WopiFile? Inspect(string file)
    {
        using var db = Open();
        using var query = Command(db, null, "SELECT name, content, version FROM files WHERE id=$id AND workspace='synthetic' AND branch='main'", ("$id", file));
        using var reader = query.ExecuteReader();
        return reader.Read() ? new(reader.GetString(0), (byte[])reader[1], reader.GetInt64(2)) : null;
    }
    public Mutation Lock(WopiSession session, string operation, string value, string? oldValue)
        => Mutate(session, operation, value, oldValue, null);
    public Mutation Write(WopiSession session, string value, byte[] content)
        => content.Length > WopiEndpoints.MaxFileBytes ? new(413) : Mutate(session, "PUT", value, null, content);

    private Mutation Mutate(WopiSession session, string operation, string value, string? oldValue, byte[]? content)
    {
        using var db = Open();
        using var tx = db.BeginTransaction();
        var current = Lookup(db, tx, session.TokenHash, session.Scope);
        if (current is null) return new(401);
        if (current.ReadOnly) return new(403);
        using var query = Command(db, tx, "SELECT lock, lock_expiry, version FROM files WHERE id=$id", ("$id", session.Scope.File));
        string activeLock;
        long version;
        using (var reader = query.ExecuteReader())
        {
            if (!reader.Read()) return new(404);
            activeLock = reader.GetInt64(1) > Now ? reader.GetString(0) : "";
            version = reader.GetInt64(2);
        }
        if (operation == "GET_LOCK") return new(200, activeLock);
        if (value.Length is 0 or > 1024 || oldValue?.Length > 1024) return new(400);
        if (operation == "PUT")
        {
            if (activeLock != value) return new(409, activeLock, "Lock missing, expired or mismatched; reopen to recover.");
            if (version != session.Version) return new(409, activeLock, "Revision conflict; preserve local edits and reopen the authoritative file.");
            using var update = Command(db, tx, "UPDATE files SET content=$content, version=version+1 WHERE id=$id AND version=$version",
                ("$content", content!), ("$id", session.Scope.File), ("$version", session.Version));
            if (update.ExecuteNonQuery() != 1) return new(409, activeLock, "Revision conflict.");
            using var history = Command(db, tx, "INSERT INTO versions VALUES($id, $version, $content)",
                ("$id", session.Scope.File), ("$version", version + 1), ("$content", content!));
            history.ExecuteNonQuery();
            using var advance = Command(db, tx, "UPDATE sessions SET version=$version WHERE token=$token", ("$version", version + 1), ("$token", current.TokenHash));
            advance.ExecuteNonQuery();
            tx.Commit();
            return new(200, Version: version + 1);
        }
        if (operation is not ("LOCK" or "REFRESH_LOCK" or "UNLOCK")) return new(501);
        var expected = operation == "LOCK" ? oldValue ?? value : value;
        if ((activeLock != "" && activeLock != expected) ||
            ((operation is "REFRESH_LOCK" or "UNLOCK" || (operation == "LOCK" && oldValue is not null)) && activeLock != expected))
            return new(409, activeLock, "Lock mismatch.");
        using var change = Command(db, tx, "UPDATE files SET lock=$lock, lock_expiry=$expiry WHERE id=$id",
            ("$lock", operation == "UNLOCK" ? "" : value), ("$expiry", operation == "UNLOCK" ? 0 : Now + 1800), ("$id", session.Scope.File));
        change.ExecuteNonQuery();
        tx.Commit();
        return new(200);
    }
}
