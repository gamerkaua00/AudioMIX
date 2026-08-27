"""Posta a cauda do log de build do Gradle como comentário no Pull Request
da branch atual (mais confiável que usar github.sha, que em eventos
pull_request aponta pra um commit de merge efêmero, não o commit real)."""
import json
import os
import sys
import urllib.request

repo = os.environ["GH_REPO"]
branch = os.environ["GH_BRANCH"]
owner = repo.split("/")[0]
token = os.environ["GH_TOKEN"]
log_path = os.environ.get("LOG_PATH", "/tmp/gradle_tail.txt")

headers = {
    "Authorization": f"token {token}",
    "Accept": "application/vnd.github+json",
    "Content-Type": "application/json",
}


def api(url, data=None, method="GET"):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


with open(log_path, encoding="utf-8", errors="replace") as f:
    body_text = f.read()

comment_body = "**Falha no build (CI)**\n```\n" + body_text + "\n```"

try:
    prs = api(f"https://api.github.com/repos/{repo}/pulls?head={owner}:{branch}&state=open")
    if prs:
        number = prs[0]["number"]
        api(f"https://api.github.com/repos/{repo}/issues/{number}/comments",
            data={"body": comment_body}, method="POST")
        print(f"Log postado no PR #{number}.")
    else:
        print("Nenhum PR aberto encontrado para a branch; log não postado.", file=sys.stderr)
except Exception as e:
    print("Falha ao postar log:", e, file=sys.stderr)

