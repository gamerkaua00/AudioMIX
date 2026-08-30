"""Registra plugins Capacitor customizados locais no MainActivity.java gerado.

O `npx cap add android` recria o MainActivity.java do zero a cada build (esse
arquivo não fica versionado no repo). Plugins locais (adicionados via
"file:./..." no package.json, como o capacitor-soundtouch) NÃO são
registrados automaticamente em tempo de execução no Android - isso é
documentado oficialmente: https://capacitorjs.com/docs/android/custom-code
É preciso chamar registerPlugin(...) manualmente dentro de onCreate().

Este script insere essa chamada logo após o Capacitor gerar o projeto
Android, então roda de novo em toda build (CI).
"""
import re
import sys

MAIN_ACTIVITY_PATH = sys.argv[1]
PLUGIN_IMPORT = "com.kmz.soundtouch.SoundTouchPlugin"

with open(MAIN_ACTIVITY_PATH, encoding="utf-8") as f:
    content = f.read()

if "registerPlugin(SoundTouchPlugin.class)" in content:
    print("MainActivity já registra o SoundTouchPlugin, nada a fazer.")
    sys.exit(0)

# Garante os imports necessários (evita duplicar se já existirem)
if f"import {PLUGIN_IMPORT};" not in content:
    content = content.replace(
        "import com.getcapacitor.BridgeActivity;",
        f"import com.getcapacitor.BridgeActivity;\nimport android.os.Bundle;\nimport {PLUGIN_IMPORT};",
        1,
    )

# Caso comum do template do Capacitor: `public class MainActivity extends BridgeActivity {}`
pattern_empty_body = re.compile(
    r"public class MainActivity extends BridgeActivity\s*\{\s*\}"
)
replacement = (
    "public class MainActivity extends BridgeActivity {\n"
    "    @Override\n"
    "    public void onCreate(Bundle savedInstanceState) {\n"
    "        registerPlugin(SoundTouchPlugin.class);\n"
    "        super.onCreate(savedInstanceState);\n"
    "    }\n"
    "}"
)

if pattern_empty_body.search(content):
    content = pattern_empty_body.sub(replacement, content)
else:
    # Corpo da classe não está vazio (template mudou) - insere dentro do
    # onCreate existente, ou cria um se não houver.
    onc_pattern = re.compile(r"(public void onCreate\(Bundle savedInstanceState\)\s*\{)")
    if onc_pattern.search(content):
        content = onc_pattern.sub(r"\1\n        registerPlugin(SoundTouchPlugin.class);", content)
    else:
        raise SystemExit(
            "Não consegui localizar onde inserir registerPlugin() - "
            "o template do MainActivity.java mudou de formato. "
            "Edite este script manualmente."
        )

with open(MAIN_ACTIVITY_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("SoundTouchPlugin registrado no MainActivity.java com sucesso.")
