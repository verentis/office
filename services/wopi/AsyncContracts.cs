using System.Globalization;

namespace Office.Wopi;

public sealed record DocumentSession(string TokenHash, FileScope Scope, string User, bool ReadOnly,
    long ExpiresAt, string Revision, WopiSession? Legacy = null);
public sealed record DocumentFile(string Name, byte[] Content, string Revision);
public sealed record DocumentMutation(int Status, string Lock = "", string? Reason = null, string? Revision = null);

public interface IAsyncWopiStore
{
    Task<DocumentSession?> AuthorizeAsync(string token, FileScope scope, CancellationToken cancellationToken);
    Task<DocumentFile?> ReadAsync(DocumentSession session, CancellationToken cancellationToken);
    Task<DocumentMutation> LockAsync(DocumentSession session, string operation, string value, string? oldValue, CancellationToken cancellationToken);
    Task<DocumentMutation> WriteAsync(DocumentSession session, string value, byte[] content, CancellationToken cancellationToken, string? correlation = null);
}

/// <summary>The synthetic harness keeps its isolated numeric-revision storage.</summary>
internal sealed class LegacyWopiAdapter(IWopiStore store) : IAsyncWopiStore
{
    public Task<DocumentSession?> AuthorizeAsync(string token, FileScope scope, CancellationToken cancellationToken)
    {
        var session = store.Authorize(token, scope);
        return Task.FromResult(session is null ? null : new DocumentSession(session.TokenHash, session.Scope,
            session.User, session.ReadOnly, session.ExpiresAt, session.Version.ToString(CultureInfo.InvariantCulture), session));
    }
    public Task<DocumentFile?> ReadAsync(DocumentSession session, CancellationToken cancellationToken)
    {
        var file = store.Read(session.Legacy!);
        return Task.FromResult(file is null ? null : new DocumentFile(file.Name, file.Content, file.Version.ToString(CultureInfo.InvariantCulture)));
    }
    public Task<DocumentMutation> LockAsync(DocumentSession session, string operation, string value, string? oldValue, CancellationToken cancellationToken)
        => Task.FromResult(Convert(store.Lock(session.Legacy!, operation, value, oldValue)));
    public Task<DocumentMutation> WriteAsync(DocumentSession session, string value, byte[] content, CancellationToken cancellationToken, string? correlation = null)
        => Task.FromResult(Convert(store.Write(session.Legacy!, value, content)));
    private static DocumentMutation Convert(Mutation result) =>
        new(result.Status, result.Lock, result.Reason, result.Version?.ToString(CultureInfo.InvariantCulture));
}
