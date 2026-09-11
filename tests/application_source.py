"""Application-wide source contracts follow feature owners after entry extraction."""
import re


def read_application_sources(root):
    directory = root / "assets/js/modules"
    sources = [(root / "assets/js/app.js").read_text(encoding="utf-8")]
    for path in sorted(directory.glob("app-*.js")):
        if path.name.startswith("app-connect-") or path.name == "app-composition.js":
            continue
        source = path.read_text(encoding="utf-8")
        source = re.sub(r"\(0, dependencies\.([$\w]+)\)", r"\1", source)
        sources.append(re.sub(r"\bdependencies\.", "", source))
    return "\n".join(sources)
