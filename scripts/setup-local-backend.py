"""Provision through public CLI APIs; never print or put returned secrets in argv."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cli", required=True, help="Path to the built Verentis CLI entry point")
parser.add_argument("--apphost", required=True, help="Local platform AppHost .csproj")
parser.add_argument("--workspace", required=True, type=uuid.UUID)
parser.add_argument("--approve", action="store_true", help="Explicitly register and approve local Office read/write pairing")
args = parser.parse_args()
if not args.approve:
    parser.error("Pass --approve only after reviewing the local Office installation and its read/write permissions.")
environment = dict(os.environ, VERENTIS_API_URL="https://api.localtest.me:6500")
workspace = str(args.workspace)


def api(method, path, scope, body=None, workspace_bound=True):
    command = ["node", str(Path(args.cli).resolve()), "api", method, path, "--scope", scope]
    if workspace_bound:
        command += ["--workspace", workspace]
    if body is not None:
        command += ["--body", "-"]
    result = subprocess.run(command, input=json.dumps(body) if body is not None else None,
                            text=True, capture_output=True, env=environment, check=False)
    if result.returncode:
        raise SystemExit("The public CLI request failed. Check login, account/workspace authorization and gateway routes. Credential output was suppressed.")
    if not result.stdout.strip():
        return None
    try:
        return json.loads(result.stdout)
    except ValueError:
        raise SystemExit("The CLI did not return a JSON response. Credential output was suppressed.") from None


installations = api("GET", f"/app-installations/app-installations?workspaceId={workspace}",
                    "resources.resource.read-all")
matches = [item for item in installations if item.get("appName") == "office"]
if len(matches) != 1:
    raise SystemExit("Install/register exactly one local Office application in this isolated workspace first.")
installation = matches[0]
credential = api("POST", "/v1/app-backend-clients", "security.appbackendclient.create",
                 {"name": "Office local backend"}, workspace_bound=False)
client_id = str(uuid.UUID(credential["clientId"]))
secret = credential["clientSecret"]
if not isinstance(secret, str) or not secret.startswith("vab_"):
    raise SystemExit("The backend registration returned an invalid credential.")
settings = {
    "Office:ClientId": client_id,
    "Parameters:office-backend-client-secret": secret,
}
stored = subprocess.run(["dotnet", "user-secrets", "set", "--project", str(Path(args.apphost).resolve())],
                        input=json.dumps(settings), text=True, capture_output=True, check=False)
if stored.returncode:
    raise SystemExit(f"Client {client_id} was registered but secret storage failed. Revoke it through the public API before retrying. No secret was printed.")
print(f"Registered backend {client_id}; credentials saved in local AppHost user-secrets.")
api("PUT", "/app-installations/approve-app-installation", "resources.resource.update", {
    "installationId": installation["id"], "workspaceId": workspace, "backendClientId": client_id,
    "consentedScopes": ["node.file.read", "node.node.create"],
})
print(f"Approved Office installation {installation['id']} for workspace {workspace}.")
print("Coordinate AppHost model reload and individual resource restarts; preserve existing Cosmos data and containers.")
print(f"Browser login: https://{workspace}.localtest.me/ (real identity-provider login required).")
