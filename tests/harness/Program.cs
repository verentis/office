using Office.Harness;
using Office.Wopi;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = WopiEndpoints.MaxFileBytes);
var editorOrigin = builder.Configuration["EditorOrigin"] ?? "https://office.localhost:8443";
var codeOrigin = new Uri(builder.Configuration["CodeOrigin"] ?? "https://code.localhost:8443");
var wopiOrigin = new Uri(builder.Configuration["WopiOrigin"] ?? "https://wopi.localhost:8443");
var discoveryUri = new Uri(builder.Configuration["DiscoveryUri"] ?? "http://code:9980/hosting/discovery");
if (new[] { new Uri(editorOrigin), codeOrigin, wopiOrigin }.Any(u => u.Scheme != "https" || u.PathAndQuery != "/"))
    throw new InvalidOperationException("Harness browser origins must be HTTPS origins.");
var data = builder.Configuration["DataDirectory"] ?? "dev/data";
Directory.CreateDirectory(data);
var fixtureDirectory = builder.Configuration["FixtureDirectory"] ?? "tests/fixtures";
builder.Services.AddSingleton(new SyntheticStore(Path.Combine(data, "synthetic.sqlite")));
builder.Services.AddSingleton<IWopiStore>(services => services.GetRequiredService<SyntheticStore>());
builder.Services.AddSingleton(new WopiOptions(editorOrigin));
builder.Services.AddSingleton(new Discovery(new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(15) }, discoveryUri, codeOrigin));
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    if (context.Request.Path.StartsWithSegments("/test"))
    {
        if (context.Request.Headers.Origin != editorOrigin || context.Request.Headers["X-Test-Identity"] != "synthetic-user")
        {
            context.Response.StatusCode = 403;
            return;
        }
    }
    try { await next(context); }
    catch (BadHttpRequestException exception) { context.Response.StatusCode = exception.StatusCode; }
    catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or System.Xml.XmlException or TaskCanceledException)
    {
        context.Response.StatusCode = 503;
        await context.Response.WriteAsJsonAsync(new { code = "synthetic_dependency_unavailable", message = "Check CODE discovery and configured origins; no live integration is available." });
    }
});
app.MapGet("/health", () => new { status = "synthetic-only", liveIntegration = "disabled" });
app.MapPost("/sessions", () => Results.Json(LiveAdmission.Blocker, statusCode: 503));
app.MapPost("/test/sessions", async (LaunchRequest request, SyntheticStore store, Discovery discovery, CancellationToken cancellationToken) =>
{
    if (!Discovery.Formats.Contains(request.Format)) return Results.BadRequest(new { error = "Unknown fixture format." });
    var file = request.FileId;
    if (file is not null && (file.Length != 32 || !file.All(Uri.IsHexDigit))) return Results.BadRequest();
    if (file is null)
        file = store.CreateFile($"synthetic.{request.Format}", await File.ReadAllBytesAsync(Path.Combine(fixtureDirectory, $"synthetic.{request.Format}"), cancellationToken));
    var document = store.Inspect(file);
    if (document is null) return Results.NotFound();
    if (Path.GetExtension(document.Name) != "." + request.Format) return Results.BadRequest();
    var source = new Uri(wopiOrigin, $"/wopi/synthetic/main/files/{file}");
    var action = await discovery.Action(request.Format, request.ReadOnly, source, cancellationToken);
    var issued = store.CreateSession(file, request.ReadOnly);
    return Results.Json(new
    {
        action, accessToken = issued.Token, accessTokenTtl = issued.Session.ExpiresAt * 1000,
        fileId = file, format = request.Format, editorOrigin = codeOrigin.GetLeftPart(UriPartial.Authority),
        wopiSource = source.AbsoluteUri, syntheticOnly = true
    });
});
app.MapGet("/test/files/{file}", (string file, SyntheticStore store) =>
{
    var document = store.Inspect(file);
    return document is null ? Results.NotFound()
        : Results.Json(new { version = document.Version, name = document.Name, content = Convert.ToBase64String(document.Content) });
});
app.MapWopi();
app.Run();

public sealed record LaunchRequest(string Format, string? FileId = null, bool ReadOnly = false);
public partial class HarnessProgram;
