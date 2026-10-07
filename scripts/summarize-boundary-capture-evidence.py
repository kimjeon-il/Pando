"""Bounded, post-exit evidence extraction; never changes browser instrumentation."""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

MAX_ZIP_BYTES = 512 * 1024 * 1024
MAX_TRACE_BYTES = 256 * 1024 * 1024
MAX_LINE_BYTES = 8 * 1024 * 1024
MAX_CONTEXTS = 4


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def context_options(row):
    # Trace headers may contain credentials and arbitrary context settings.
    # Export only the ordinary settings relevant to this desktop comparison.
    options = row.get('options', {})
    safe = {key: options[key] for key in (
        'noDefaultViewport', 'ignoreHTTPSErrors', 'javaScriptEnabled', 'bypassCSP',
        'offline', 'isMobile', 'hasTouch'
    ) if isinstance(options.get(key), bool)}
    viewport = options.get('viewport')
    if isinstance(viewport, dict) and all(
        isinstance(viewport.get(key), int) and 0 < viewport[key] < 100000
        for key in ('width', 'height')
    ):
        safe['viewport'] = {key: viewport[key] for key in ('width', 'height')}
    if options.get('colorScheme') in ('light', 'dark', 'no-preference'):
        safe['colorScheme'] = options['colorScheme']
    if options.get('serviceWorkers') in ('allow', 'block'):
        safe['serviceWorkers'] = options['serviceWorkers']
    version = row.get('playwrightVersion', '')
    return {
        'origin': row.get('origin') if row.get('origin') in ('library', 'testRunner') else None,
        'browserName': row.get('browserName') if row.get('browserName') in ('chromium', 'firefox', 'webkit', '') else None,
        'playwrightVersion': version if isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version) else None,
        'options': safe,
    }


def trace_metadata(output, screenshots):
    result = {
        'status': 'missing', 'path': None, 'bytes': None, 'sha256': None,
        'domSnapshotCount': None, 'screencastFrameCount': None,
        'sourceResourceCount': None, 'matchesCaptureCondition': None,
        'contextOptions': [], 'contextOptionsOmitted': 0,
        'effectiveTraceOptions': {
            'status': 'unavailable',
            'reason': 'Trace capture options are absent from Playwright context-options headers; use observed event counts.',
        },
    }
    traces = list(output.rglob('trace.zip'))
    if not traces:
        return result
    try:
        if len(traces) != 1:
            raise ValueError('Expected one desktop trace')
        path = traces[0]
        result['path'] = path.relative_to(output).as_posix()
        result['bytes'] = path.stat().st_size
        if result['bytes'] > MAX_ZIP_BYTES:
            raise ValueError('ZIP size bound exceeded')
        result['sha256'] = digest(path)
        snapshots = frames = sources = contexts = trace_bytes = trace_members = 0
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                sources += info.filename.startswith('resources/src@')
                if not info.filename.endswith('.trace'):
                    continue
                trace_members += 1
                trace_bytes += info.file_size
                if trace_bytes > MAX_TRACE_BYTES:
                    raise ValueError('Trace size bound exceeded')
                with archive.open(info) as stream:
                    while True:
                        line = stream.readline(MAX_LINE_BYTES + 1)
                        if not line:
                            break
                        if len(line) > MAX_LINE_BYTES:
                            raise ValueError('Trace line bound exceeded')
                        row = json.loads(line)
                        snapshots += row.get('type') == 'frame-snapshot'
                        frames += row.get('type') == 'screencast-frame'
                        if row.get('type') == 'context-options':
                            contexts += 1
                            if len(result['contextOptions']) < MAX_CONTEXTS:
                                result['contextOptions'].append(context_options(row))
        if not trace_members:
            raise ValueError('No trace event streams')
        result.update(status='available', domSnapshotCount=snapshots,
                      screencastFrameCount=frames, sourceResourceCount=sources,
                      matchesCaptureCondition=(frames > 0 if screenshots else frames == 0),
                      contextOptionsOmitted=max(0, contexts - MAX_CONTEXTS))
    except Exception as error:
        # Partial counts never masquerade as complete counts or absence.
        result['status'] = 'error'
        result['error'] = type(error).__name__
    return result


def diagnostic_file(output, evidence, name, limit):
    result = {'status': 'missing', 'path': None, 'bytes': None, 'sha256': None}
    paths = list(output.rglob(name))
    if not paths:
        return result
    try:
        if len(paths) != 1:
            raise ValueError('Ambiguous diagnostic file')
        path = paths[0]
        result['bytes'] = path.stat().st_size
        if result['bytes'] > limit:
            raise ValueError('Diagnostic size bound exceeded')
        body = path.read_bytes()
        value = json.loads(body)
        if not isinstance(value, dict) or value.get('label') != 'boundary-project-undo':
            raise ValueError('Unexpected diagnostic contract')
        (evidence / name).write_bytes(body)
        result.update(status='available', path=name,
                      sha256=hashlib.sha256(body).hexdigest())
    except Exception as error:
        result['status'] = 'error'
        result['error'] = type(error).__name__
    return result


def summarize(output, evidence, screenshots):
    evidence.mkdir(parents=True, exist_ok=True)
    trace = trace_metadata(output, screenshots)
    diagnostics = {
        'native': diagnostic_file(output, evidence, 'boundary-project-undo-native-action.json', 256 * 1024),
        'cpu': diagnostic_file(output, evidence, 'boundary-project-undo-cpu-summary.json', 32 * 1024),
    }
    complete = (trace['status'] == 'available' and trace['domSnapshotCount'] > 0
                and trace['sourceResourceCount'] > 0 and trace['matchesCaptureCondition']
                and all(value['status'] == 'available' for value in diagnostics.values()))
    metadata = {
        'schemaVersion': 1, 'status': 'complete' if complete else 'incomplete',
        'requestedTraceOptions': {'mode': 'on', 'screenshots': screenshots,
                                  'snapshots': True, 'sources': True, 'attachments': True},
        'trace': trace, 'diagnostics': diagnostics,
    }
    (evidence / 'trace-metadata.json').write_text(json.dumps(metadata, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    return 0 if complete else 1


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[3] not in ('true', 'false'):
        raise SystemExit('Expected output directory, evidence directory, and exact true/false capture flag')
    raise SystemExit(summarize(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] == 'true'))
