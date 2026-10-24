"""Executed inside the managed QGIS desktop, using the upstream plugin unchanged."""
import json
import os
from pathlib import Path
import sys

from qgis.core import QgsSettings
from qgis.PyQt.QtCore import QTimer
from qgis.utils import iface

config = json.loads(Path(os.environ['PANDO_QGIS_CONFIG']).read_text(encoding='utf-8'))
sys.path.insert(0, config['pluginRoot'])
QgsSettings().setValue('qgis_mcp/first_run', False)


def initialize():
    from qgis_mcp_plugin import classFactory
    # QGIS owns the plugin and its timer for the lifetime of this managed session.
    global plugin
    plugin = classFactory(iface)
    plugin.initGui()
    if plugin.server is None:
        plugin.action.setChecked(True)
        plugin.toggle_server(True)
    if plugin.server is None:
        raise RuntimeError('QGIS MCP listener failed to start')


QTimer.singleShot(0, initialize)
