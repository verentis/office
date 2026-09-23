using Office.Wopi;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { status = "healthy", liveIntegration = "disabled" }));
app.MapPost("/sessions", () => Results.Json(LiveAdmission.Blocker, statusCode: 503));
app.MapMethods("/wopi/{**path}", ["GET", "POST", "PUT", "DELETE"], () => Results.Unauthorized());
app.Run();

public partial class Program;
