"""Read-only checks: never start a daemon, connect the extension or send mail."""
import socket
import urllib.request

for port in (5900, 6080):
    with socket.create_connection(('127.0.0.1', port), timeout=2):
        pass
with urllib.request.urlopen('http://127.0.0.1:3000/api/version', timeout=3) as response:
    assert response.status == 200
