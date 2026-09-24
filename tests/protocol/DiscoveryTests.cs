using Office.Wopi;
using Xunit;

namespace Office.Protocol.Tests;

public sealed class DiscoveryTests
{
    public static IEnumerable<object[]> SupportedFormats => Discovery.Formats.Select(format => new object[] { format });

    [Theory]
    [MemberData(nameof(SupportedFormats))]
    public async Task Every_registered_format_selects_its_supported_action(string format)
    {
        var action = Discovery.CanEdit(format) ? "edit" : "view";
        var discovery = Create($"""<wopi-discovery><action ext="{format}" name="{action}" urlsrc="https://code.localhost:8443/browser/abc/cool.html?"/></wopi-discovery>""");
        Assert.Contains("WOPISrc=", await discovery.Action(format, false, new("https://wopi.localhost:8443/wopi/test/main/files/f")));
    }

    private static Discovery Create(string xml) => new(new HttpClient(new Handler(xml)), new("http://configured-code/hosting/discovery"), new("https://code.localhost:8443"));
    [Fact]
    public async Task SelectsConfiguredActionAndBindsSource()
    {
        var discovery = Create("""<wopi-discovery><net-zone><app><action ext="docx" name="edit" urlsrc="https://code.localhost:8443/browser/abc/cool.html?&lt;ui=UI_LL&amp;&gt;"/></app></net-zone></wopi-discovery>""");
        var result = await discovery.Action("docx", false, new("https://wopi.localhost:8443/wopi/synthetic/main/files/f"));
        Assert.Contains("WOPISrc=https%3A%2F%2Fwopi.localhost", result);
        Assert.DoesNotContain("UI_LL", result);
        await Assert.ThrowsAsync<ArgumentException>(() => discovery.Action("exe", false, new("https://wopi.localhost:8443")));
        await Assert.ThrowsAsync<InvalidOperationException>(() => discovery.Action("docx", true, new("https://wopi.localhost:8443")));
    }
    [Theory]
    [InlineData("https://evil.example/browser/abc/cool.html?")]
    [InlineData("http://code.localhost:8443/browser/abc/cool.html?")]
    [InlineData("https://user:password@code.localhost:8443/browser/abc/cool.html?")]
    public async Task RejectsUntrustedDiscoveryDestination(string url)
    {
        var discovery = Create($"""<wopi-discovery><action ext="docx" name="edit" urlsrc="{url}"/></wopi-discovery>""");
        await Assert.ThrowsAsync<InvalidOperationException>(() => discovery.Action("docx", false, new("https://wopi.localhost:8443")));
    }
    [Fact]
    public async Task RejectsExternalEntities()
    {
        var discovery = Create("""<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><wopi-discovery>&x;</wopi-discovery>""");
        await Assert.ThrowsAsync<System.Xml.XmlException>(() => discovery.Action("docx", false, new("https://wopi.localhost:8443")));
    }
    [Fact]
    public async Task BoundsBodyReadAfterHeadersArrive()
    {
        using var stream = new StalledStream();
        var discovery = new Discovery(new HttpClient(new StreamHandler(stream)),
            new("http://configured-code/hosting/discovery"), new("https://code.localhost:8443"));
        var pending = discovery.Action("docx", false, new("https://wopi.localhost:8443"));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending.WaitAsync(TimeSpan.FromSeconds(20)));
        stream.Complete();
    }
    private sealed class StreamHandler(Stream stream) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StreamContent(stream) });
    }
    private sealed class StalledStream : MemoryStream
    {
        private readonly TaskCompletionSource<int> _read = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Complete() => _read.TrySetResult(0);
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => _read.Task.WaitAsync(cancellationToken);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
            => new(_read.Task.WaitAsync(cancellationToken));
    }
    private sealed class Handler(string xml) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(xml) });
    }
}
