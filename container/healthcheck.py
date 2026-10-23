"""Read-only checks: never start a daemon, connect the extension or send mail."""
import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
import urllib.request

for port in (5900, 6080):
    with socket.create_connection(('127.0.0.1', port), timeout=2):
        pass
with urllib.request.urlopen('http://127.0.0.1:3000/api/version', timeout=3) as response:
    assert response.status == 200

# Worker readiness is required only after a user explicitly enables
# automation. Missing configuration leaves the worker idle and keeps the
# ordinary web/desktop health contract unchanged.
root = Path(os.environ.get('CAREER_OPS_ROOT', '/data'))
config_path = root / 'config' / 'automation.json'
if config_path.exists():
    try:
        config = json.loads(config_path.read_text())
    except (OSError, json.JSONDecodeError):
        config = {}
    if isinstance(config, dict) and config.get('enabled') is True:
        heartbeat_path = root / 'data' / 'automation' / 'worker-heartbeat.json'
        heartbeat = json.loads(heartbeat_path.read_text())
        assert heartbeat.get('enabled') is True
        at = datetime.fromisoformat(heartbeat['at'].replace('Z', '+00:00'))
        age = (datetime.now(timezone.utc) - at).total_seconds()
        assert -30 <= age < 180
        pid = heartbeat.get('pid')
        assert isinstance(pid, int) and pid > 0
        try:
            os.kill(pid, 0)
        except PermissionError:
            pass
