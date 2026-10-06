"""Read current application owners without rewriting their dependency boundaries."""
import json
import subprocess
from functools import lru_cache


def read_application_sources(root):
    paths = [root / "assets/js/app.js", *sorted((root / "assets/js/modules").glob("app-*.js"))]
    return "\n".join(path.read_text(encoding="utf-8") for path in paths)


@lru_cache(maxsize=None)
def ui_sources(root):
    result = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import { UI_AUDIT_STYLE_SOURCES } from './scripts/lib/ui-source-catalog.mjs'; console.log(JSON.stringify(UI_AUDIT_STYLE_SOURCES));"],
        cwd=root, text=True, encoding="utf-8", capture_output=True, check=True,
    )
    return tuple(json.loads(result.stdout))


def read_ui_sources(root):
    return "\n".join((root / path).read_text(encoding="utf-8") for path in ui_sources(root))


def read_module(root, name):
    return (root / "assets/js/modules" / name).read_text(encoding="utf-8")


def assert_shell_versions(case, root, markup):
    import re
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    case.assertIn(f'data-app-version="{version}"', markup)
    urls = re.findall(r'(?:src|href)="(assets/[^"?]+)\?v=([^"&]+)', markup)
    case.assertTrue(urls)
    for path, revision in urls:
        case.assertTrue((root / path).is_file(), path)
        case.assertTrue(revision.startswith(version + "-build-"), (path, revision))
    case.assertEqual(len({revision for _, revision in urls}), 1)


def function_source(source, name):
    import re
    start = re.search(r"(?m)^([ \t]*)(?:export )?(?:async )?function " + re.escape(name) + r"\(", source)
    if not start:
        raise ValueError(f"Missing current function: {name}")
    indent = start.group(1)
    closing = re.search(r"\n" + re.escape(indent) + r"}[ \t]*(?=\n|$)", source[start.end():])
    if not closing:
        raise ValueError(f"Unclosed current function: {name}")
    end = start.end() + closing.end()
    return source[start.start() + len(indent):end]


def element_markup(source, element_id):
    import re
    opening = re.search(r'<([\w-]+)\b[^>]*\bid="' + re.escape(element_id) + r'"[^>]*>', source)
    if not opening:
        raise ValueError(f"Missing current element: {element_id}")
    tag = opening.group(1)
    if tag in {"input", "use", "img", "link", "meta"}:
        return opening.group(0)
    depth = 1
    for token in re.finditer(r'</?' + re.escape(tag) + r'\b[^>]*>', source[opening.end():]):
        depth += -1 if token.group(0).startswith("</") else 1
        if depth == 0:
            return source[opening.start():opening.end() + token.end()]
    raise ValueError(f"Unclosed current element: {element_id}")


def node_json(root, source):
    result = subprocess.run(["node", "--input-type=module", "-e", source], cwd=root,
                            text=True, encoding="utf-8", capture_output=True, check=True)
    return json.loads(result.stdout)
