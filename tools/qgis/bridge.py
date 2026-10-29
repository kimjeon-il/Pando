"""Pando's file exchange with the upstream QGIS MCP client, not another GIS engine."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / '.library-data/qgis.json'
def accept_code_result(response):
    if response.get('status') != 'success':
        raise RuntimeError(response.get('message', 'QGIS command failed'))
    result = response.get('result', {})
    if result.get('executed') is not True:
        raise RuntimeError(result.get('error', 'QGIS script failed'))
    return result


def export_code(output, layer_id):
    return f'''from qgis.core import QgsProject, QgsVectorFileWriter, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsField
from qgis.PyQt.QtCore import QVariant
from pathlib import Path
import json
destination = Path({str(output)!r})
if destination.exists():
    raise FileExistsError(str(destination))
layer = QgsProject.instance().mapLayer({layer_id!r})
if layer is None or not layer.isValid():
    raise ValueError('Unknown or invalid QGIS layer')
if not layer.crs().isValid():
    raise ValueError('Source CRS is required')
for feature in layer.getFeatures():
    if feature.geometry().isNull() or feature.geometry().isEmpty() or not feature.geometry().isGeosValid():
        raise ValueError('Invalid source geometry: ' + str(feature.id()))
options = QgsVectorFileWriter.SaveVectorOptions()
class SourceFieldConverter(QgsVectorFileWriter.FieldValueConverter):
    def fieldDefinition(self, field):
        if field.name() == 'source' and field.type() == QVariant.Map:
            return QgsField(field.name(), QVariant.String)
        return field

    def convert(self, index, value):
        if layer.fields()[index].name() == 'source' and isinstance(value, dict):
            return json.dumps(value, ensure_ascii=False, allow_nan=False)
        return value

converter = SourceFieldConverter()
options.fieldValueConverter = converter
options.driverName = 'GeoJSON'
options.fileEncoding = 'UTF-8'
options.layerOptions = ['RFC7946=YES', 'COORDINATE_PRECISION=15']
options.ct = QgsCoordinateTransform(layer.crs(), QgsCoordinateReferenceSystem('EPSG:4326'), QgsProject.instance())
options.overrideGeometryType = layer.wkbType()
options.includeZ = False
written = QgsVectorFileWriter.writeAsVectorFormatV3(layer, str(destination), QgsProject.instance().transformContext(), options)
if written[0] != QgsVectorFileWriter.NoError:
    raise RuntimeError(str(written))
print(json.dumps({{'output': str(destination), 'features': layer.featureCount(), 'crs': 'EPSG:4326'}}))
'''


def export_layer(client, layer_id, output):
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(str(output))
    # A private directory establishes ownership even when QGIS or validation fails.
    with tempfile.TemporaryDirectory(prefix='.pando-qgis-', dir=output.parent) as folder:
        temporary = Path(folder) / 'export.geojson'
        executed = accept_code_result(client.execute_code(export_code(temporary, layer_id)))
        try:
            subprocess.run(['node', str(ROOT / 'tools/qgis/normalize.mjs'), str(temporary), '--output', str(output)],
                           check=True, capture_output=True, text=True, encoding='utf-8', timeout=120)
        except subprocess.CalledProcessError as error:
            raise RuntimeError('QGIS exchange normalization failed: ' + (error.stderr or str(error))) from error
    return dict(output=str(output), qgis=executed)


def load_config(path=CONFIG):
    config = json.loads(Path(path).read_text(encoding='utf-8'))
    if config.get('host') != '127.0.0.1' or not config.get('token') or not 1024 <= config.get('port', 0) <= 65535:
        raise ValueError('Authenticated loopback QGIS configuration is required')
    return config


def connect(config):
    from qgis_mcp.client import QgisMCPClient
    os.environ['QGIS_MCP_TOKEN'] = config['token']
    client = QgisMCPClient(host=config['host'], port=config['port'])
    if not client.connect():
        client.disconnect()
        raise ConnectionError('QGIS MCP listener is not ready')
    return client


def checked(response):
    if response.get('status') != 'success':
        raise RuntimeError(response.get('message', 'QGIS operation failed'))
    return response['result']


def start(config, config_path):
    launcher = Path(config['qgisRoot']) / 'bin/qgis-ltr.bat'
    if not launcher.is_file():
        raise FileNotFoundError('QGIS LTR is not installed: ' + str(launcher))
    # An occupied port must not cause a second application or replace another user session.
    import socket
    with socket.socket() as probe:
        if probe.connect_ex((config['host'], config['port'])) == 0:
            client = connect(config)
            try:
                return checked(client.get_qgis_info())
            finally:
                client.disconnect()
    env = {**os.environ, 'QGIS_MCP_TOKEN': config['token'], 'QGIS_MCP_PORT': str(config['port']),
           'PANDO_QGIS_CONFIG': str(Path(config_path).resolve())}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    subprocess.Popen([os.environ['COMSPEC'], '/d', '/c', str(launcher), '--nologo', '--noversioncheck',
                      '--profiles-path', config['profilesRoot'], '--profile', 'pando',
                      '--code', str(Path(__file__).with_name('bootstrap.py'))],
                     env=env, startupinfo=startup, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(120):
        time.sleep(.5)
        try:
            client = connect(config)
        except ConnectionError:
            continue
        try:
            return checked(client.get_qgis_info())
        finally:
            client.disconnect()
    raise RuntimeError('Managed QGIS did not start; inspect its profile log')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=CONFIG)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('start')
    commands.add_parser('status')
    opening = commands.add_parser('open')
    opening.add_argument('input', type=Path)
    exporting = commands.add_parser('export')
    exporting.add_argument('--layer', required=True)
    exporting.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    config = load_config(args.config)
    if args.command == 'start':
        print(json.dumps(start(config, args.config), ensure_ascii=False))
        return
    client = connect(config)
    try:
        if args.command == 'status':
            result = checked(client.get_qgis_info())
        elif args.command == 'open':
            path = args.input.resolve(strict=True)
            result = checked(client.add_vector_layer(str(path), name=path.stem))
        else:
            result = export_layer(client, args.layer, args.output)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        client.disconnect()


if __name__ == '__main__':
    main()
