namespace Office.Wopi;

public sealed record FileScope(string Workspace, string Branch, string File);
public sealed record WopiFile(string Name, byte[] Content, long Version);
public sealed record WopiSession(string TokenHash, FileScope Scope, string User, bool ReadOnly, long ExpiresAt, long Version);
public sealed record Mutation(int Status, string Lock = "", string? Reason = null, long? Version = null);

public interface IWopiStore
{
    WopiSession? Authorize(string token, FileScope scope);
    WopiFile? Read(WopiSession session);
    Mutation Lock(WopiSession session, string operation, string value, string? oldValue);
    Mutation Write(WopiSession session, string value, byte[] content);
}
