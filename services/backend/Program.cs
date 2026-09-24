using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Office.Backend;
using Office.Wopi;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
// WOPI query strings contain credentials. Neither framework requests nor
// HttpClient diagnostic URLs/bodies are logged by this application.
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Logging.AddFilter("System.Net.Http.HttpClient", LogLevel.None);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = WopiEndpoints.MaxFileBytes);
var configuration = builder.Configuration;
var clientSecret = configuration["Office:ClientSecret"];
var configured = Guid.TryParse(configuration["Office:ClientId"], out var clientId) &&
    clientId != Guid.Empty && !string.IsNullOrWhiteSpace(clientSecret) &&
    !string.IsNullOrWhiteSpace(configuration["Office:PlatformOrigin"]);
var editorOrigin = Origin(configuration["EditorOrigin"] ?? "https://office.localtest.me");
var codeOrigin = Origin(configuration["CodeOrigin"] ?? "https://office-code.localtest.me");
var wopiOrigin = Origin(configuration["WopiOrigin"] ?? "https://office-wopi.localtest.me");
var dataDirectory = Path.GetFullPath(configuration["DataDirectory"] ?? Path.Combine(AppContext.BaseDirectory, "data"));
if (configured)
{
    var platformOrigin = Origin(configuration["Office:PlatformOrigin"]!);
    Directory.CreateDirectory(dataDirectory);
    if (!OperatingSystem.IsWindows())
        File.SetUnixFileMode(dataDirectory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    builder.Services.AddDataProtection().SetApplicationName("Verentis.Office")
        .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDirectory, "keys")));
    builder.Services.AddSingleton(new BackendIdentity(clientId, clientSecret!, platformOrigin));
    builder.Services.AddHttpClient<PlatformFileClient>(client =>
    {
        client.Timeout = TimeSpan.FromSeconds(30);
        client.MaxResponseContentBufferSize = 4 * 1024 * 1024;
    }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
    builder.Services.AddSingleton(services => new LiveOfficeStore(dataDirectory,
        services.GetRequiredService<IDataProtectionProvider>(), services.GetRequiredService<PlatformFileClient>()));
    builder.Services.AddSingleton<IAsyncWopiStore>(services => services.GetRequiredService<LiveOfficeStore>());
    builder.Services.AddSingleton(new WopiOptions(editorOrigin.AbsoluteUri.TrimEnd('/')));
    builder.Services.AddSingleton(new Discovery(
        new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) },
        new Uri(codeOrigin, "hosting/discovery"), codeOrigin));
}
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    if (context.Request.Path.StartsWithSegments("/sessions") &&
        context.Request.Headers.Origin != editorOrigin.AbsoluteUri.TrimEnd('/'))
    {
        context.Response.StatusCode = 403;
        return;
    }
    try { await next(context); }
    catch (PlatformFailure failure)
    {
        context.Response.StatusCode = failure.Status is 400 or 401 or 403 or 404 or 409 or 412 or 413 or 415
            ? failure.Status : 503;
        await context.Response.WriteAsJsonAsync(new
        {
            code = context.Response.StatusCode is 409 or 412 ? "file_conflict" : "office_operation_unavailable",
            message = "The authorized operation did not complete. Preserve edits; verify access and session status before retrying."
        });
    }
    catch (BadHttpRequestException exception) { context.Response.StatusCode = exception.StatusCode; }
    catch (Exception)
    {
        if (context.Response.HasStarted)
        {
            context.Abort();
            return;
        }
        context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { code = "office_dependency_unavailable", message = "Check backend setup, TLS and discovery. Do not discard unverified edits." });
    }
});
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy", backendConfigured = configured, draining = File.Exists(Path.Combine(dataDirectory, "draining"))
}));
if (!configured)
{
    app.MapPost("/sessions", () => Results.Json(new
    {
        code = "office_backend_setup_required",
        message = "Register an independent backend client, configure its local secret, and have an administrator pair the Office installation."
    }, statusCode: 503));
    app.MapMethods("/wopi/{**path}", ["GET", "POST"], () => Results.Unauthorized());
}
else
{
    // Instantiate now: an accidental second backend must fail startup rather than
    // racing another process's in-flight callbacks.
    _ = app.Services.GetRequiredService<LiveOfficeStore>();
    app.MapPost("/sessions", async (LaunchRequest request, LiveOfficeStore store, Discovery discovery, CancellationToken token) =>
    {
        if (File.Exists(Path.Combine(dataDirectory, "draining"))) return Results.StatusCode(503);
        var session = await store.Create(request, token);
        var source = new Uri(wopiOrigin, $"wopi/{session.Scope.Workspace}/{session.Scope.Branch}/files/{session.Scope.File}");
        var format = Path.GetExtension(session.Name).TrimStart('.').ToLowerInvariant();
        var action = await discovery.Action(format, session.ReadOnly, source, token);
        return Results.Json(new
        {
            action, accessToken = session.WopiCredential, accessTokenTtl = session.ExpiresAt.ToUnixTimeMilliseconds(),
            fileId = session.Scope.File, format, editorOrigin = codeOrigin.AbsoluteUri.TrimEnd('/'),
            wopiSource = source.AbsoluteUri, syntheticOnly = false, sessionId = session.SessionId,
            statusCredential = session.StatusCredential, readOnly = session.ReadOnly, name = session.Name
        });
    }).WithMetadata(new RequestSizeLimitAttribute(16 * 1024));
    app.MapGet("/sessions/{id}/status", async (HttpContext context, string id, LiveOfficeStore store, CancellationToken token) =>
        Results.Json(await store.Status(id, StatusCredential(context), token)));
    app.MapPost("/sessions/{id}/saves", async (HttpContext context, string id, SaveRequest request, LiveOfficeStore store, CancellationToken token) =>
        Results.Json(await store.BeginSave(id, StatusCredential(context), request.Generation, token)))
        .WithMetadata(new RequestSizeLimitAttribute(1024));
    app.MapDelete("/sessions/{id}", async (HttpContext context, string id, LiveOfficeStore store, CancellationToken token) =>
    {
        await store.Close(id, StatusCredential(context), token);
        return Results.NoContent();
    });
    app.MapWopi();
}
app.Run();

static Uri Origin(string value) =>
    Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
    uri.PathAndQuery == "/" && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Fragment)
        ? uri : throw new InvalidOperationException("Configure exact trusted HTTPS origins.");

static string StatusCredential(HttpContext context)
{
    var values = context.Request.Headers.Authorization;
    return values.Count == 1 && values[0] is { Length: 50 } value && value.StartsWith("Bearer ", StringComparison.Ordinal)
        ? value[7..] : throw new PlatformFailure(401);
}

public sealed record SaveRequest(long Generation);
public partial class Program;
