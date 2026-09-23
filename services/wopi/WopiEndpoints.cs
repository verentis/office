using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Office.Wopi;

public static class WopiEndpoints
{
    public const int MaxFileBytes = 16 * 1024 * 1024;

    public static void MapWopi(this IEndpointRouteBuilder app)
    {
        app.MapMethods("/wopi/{workspace}/{branch}/files/{file}/{**tail}", ["GET", "POST"],
            async (HttpContext context, IWopiStore store, string workspace, string branch, string file, string? tail) =>
            {
                var request = context.Request;
                context.Response.Headers.CacheControl = "no-store";
                var token = request.Query["access_token"];
                if (token.Count != 1 || token[0] is not { Length: 43 } credential)
                    return Results.Unauthorized();
                var session = store.Authorize(credential, new(workspace, branch, file));
                if (session is null) return Results.Unauthorized();
                if (request.Method == "GET")
                {
                    var document = store.Read(session);
                    if (document is null) return Results.NotFound();
                    if (tail == "contents") return Results.Bytes(document.Content, "application/octet-stream");
                    if (!string.IsNullOrEmpty(tail)) return Results.NotFound();
                    return Results.Json(new
                    {
                        BaseFileName = document.Name,
                        OwnerId = "synthetic-owner",
                        Size = document.Content.LongLength,
                        UserId = session.User,
                        UserFriendlyName = "Synthetic test user",
                        Version = document.Version.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        UserCanWrite = !session.ReadOnly,
                        ReadOnly = session.ReadOnly,
                        SupportsUpdate = !session.ReadOnly,
                        SupportsLocks = !session.ReadOnly,
                        SupportsGetLock = !session.ReadOnly,
                        SupportsRename = false,
                        SupportsDeleteFile = false,
                        SupportsUserInfo = false,
                        PostMessageOrigin = context.RequestServices.GetService(typeof(WopiOptions)) is WopiOptions options ? options.EditorOrigin : "",
                        EnableOwnerTermination = false
                    }, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = null });
                }
                if (session.ReadOnly) return Results.StatusCode(403);
                var operation = request.Headers["X-WOPI-Override"].ToString();
                var value = request.Headers["X-WOPI-Lock"].ToString();
                if (value.Length > 1024 || request.Headers["X-WOPI-OldLock"].ToString().Length > 1024)
                    return Results.BadRequest();
                Mutation result;
                if (tail == "contents" && operation == "PUT")
                {
                    if (request.ContentLength > MaxFileBytes) return Results.StatusCode(413);
                    using var buffer = new MemoryStream();
                    var chunk = new byte[64 * 1024];
                    int count;
                    while ((count = await request.Body.ReadAsync(chunk, context.RequestAborted)) != 0)
                    {
                        if (buffer.Length + count > MaxFileBytes) return Results.StatusCode(413);
                        await buffer.WriteAsync(chunk.AsMemory(0, count), context.RequestAborted);
                    }
                    result = store.Write(session, value, buffer.ToArray());
                }
                else if (string.IsNullOrEmpty(tail) && operation is "LOCK" or "REFRESH_LOCK" or "UNLOCK" or "GET_LOCK")
                {
                    result = store.Lock(session, operation, value, request.Headers["X-WOPI-OldLock"].FirstOrDefault());
                }
                else return Results.StatusCode(501);
                if (result.Status == 409 || operation == "GET_LOCK")
                    context.Response.Headers["X-WOPI-Lock"] = result.Lock;
                if (result.Reason is not null)
                    context.Response.Headers["X-WOPI-LockFailureReason"] = result.Reason;
                if (result.Version is not null)
                    context.Response.Headers["X-WOPI-ItemVersion"] = result.Version.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return Results.StatusCode(result.Status);
            });
    }
}

public sealed record WopiOptions(string EditorOrigin);
