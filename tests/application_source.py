"""Read current application owners for remaining historical and hydro source checks."""


def read_application_sources(root):
    paths = [root / "assets/js/app.js", *sorted((root / "assets/js/modules").glob("app-*.js"))]
    return "\n".join(path.read_text(encoding="utf-8") for path in paths)


def read_module(root, name):
    return (root / "assets/js/modules" / name).read_text(encoding="utf-8")


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
