namespace Office.Wopi;

public static class LiveAdmission
{
    public static object Blocker => new
    {
        code = "platform_prerequisites_missing",
        message = "Live Office integration is disabled. Recipient/installation/branch-bound delegation, authoritative file identity and atomic conditional uploads are not established.",
        gates = new[] { "B: delegated read", "C: conditional editing", "D: formats/collaboration", "E: operations" }
    };
}
