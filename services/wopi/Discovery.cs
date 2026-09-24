using System.Text.RegularExpressions;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;

namespace Office.Wopi;

public sealed partial class Discovery(HttpClient client, Uri discoveryUri, Uri editorOrigin)
{
    private static readonly IReadOnlyDictionary<string, DocumentFormat> Catalog = LoadFormats();
    public static readonly string[] Formats = Catalog.Keys.ToArray();
    public static bool CanEdit(string format) => Catalog.TryGetValue(format, out var entry) && entry.Mode == "edit";

    private static IReadOnlyDictionary<string, DocumentFormat> LoadFormats()
    {
        using var stream = typeof(Discovery).Assembly.GetManifestResourceStream("Office.Formats.json")
            ?? throw new InvalidOperationException("Office format catalog is missing.");
        return JsonSerializer.Deserialize<Dictionary<string, DocumentFormat>>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Office format catalog is invalid.");
    }

    private sealed record DocumentFormat(string[] MimeTypes, string Mode, string Icon);

    public async Task<string> Action(string format, bool readOnly, Uri wopiSource, CancellationToken cancellationToken = default)
    {
        if (!Formats.Contains(format, StringComparer.Ordinal)) throw new ArgumentException("Unsupported document format.");
        readOnly |= !CanEdit(format);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(15));
        cancellationToken = deadline.Token;
        using var response = await client.GetAsync(discoveryUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var content = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int count;
        while ((count = await stream.ReadAsync(chunk, cancellationToken)) != 0)
        {
            if (content.Length + count > 4 * 1024 * 1024) throw new InvalidOperationException("Discovery exceeds the size limit.");
            content.Write(chunk, 0, count);
        }
        content.Position = 0;
        using var reader = XmlReader.Create(content, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 * 1024 * 1024, Async = true
        });
        var xml = await XDocument.LoadAsync(reader, LoadOptions.None, cancellationToken);
        var action = xml.Descendants("action").FirstOrDefault(e =>
            (string?)e.Attribute("ext") == format && (string?)e.Attribute("name") == (readOnly ? "view" : "edit"));
        var raw = (string?)action?.Attribute("urlsrc") ?? throw new InvalidOperationException("Configured CODE has no matching action.");
        var clean = Placeholders().Replace(raw, "");
        if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || uri.GetLeftPart(UriPartial.Authority) != editorOrigin.GetLeftPart(UriPartial.Authority) ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("Discovery returned an untrusted editor origin.");
        return clean + (clean.Contains('?') ? "&" : "?") + "WOPISrc=" + Uri.EscapeDataString(wopiSource.AbsoluteUri) + "&lang=en-US";
    }

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex Placeholders();
}
