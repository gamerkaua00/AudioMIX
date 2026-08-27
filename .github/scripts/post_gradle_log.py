"""Posta a cauda do log de build do Gradle como comentário no commit,
para que seja possível diagnosticar falhas de build sem baixar logs brutos
(o que exige acesso a hosts de blob storage às vezes bloqueados)."""
import json
import os
import sys
import urllib.request

repo = os.environ["GH_REPO"]
sha = os.environ["GH_SHA"]
token = os.environ["GH_TOKEN"]
log_path = os.environ.get("LOG_PATH", "/tmp/gradle_tail.txt")

with open(log_path, encoding="utf-8", errors="replace") as f:
    body_text = f.read()

payload = json.dumps({"body": "```\n" + body_text + "\n```"}).encode("utf-8")

req = urllib.request.Request(
    f"https://api.github.com/repos/{repo}/commits/{sha}/comments",
    data=payload,
    method="POST",
    headers={
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    },
)

try:
    with urllib.request.urlopen(req) as resp:
        print("Log postado como comentário do commit. Status:", resp.status)
except Exception as e:
    print("Falha ao postar log:", e, file=sys.stderr)
