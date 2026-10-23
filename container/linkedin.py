#!/usr/bin/env python3
"""Container-local LinkedIn MCP and its persistent, separately owned login."""
import json
import os
from pathlib import Path
import subprocess
import sys

SERVER = '/opt/linkedin/bin/mcp-server-linkedin'
COMMAND = '/usr/local/bin/career-ops-linkedin'


def configure():
    """Register once through Codex, preserving any existing user registration."""
    result = subprocess.run(['codex', 'mcp', 'list', '--json'], check=True,
                            capture_output=True, text=True)
    servers = json.loads(result.stdout)
    if any(server.get('name') == 'linkedin' for server in servers):
        return False
    subprocess.run(['codex', 'mcp', 'add', 'linkedin', '--', COMMAND, 'serve'], check=True)
    return True


def invocation(action, extra=()):
    profile = Path.home() / '.linkedin-mcp/profile'
    common = [SERVER, '--user-data-dir', str(profile), '--chrome-path',
              '/opt/chrome-linux64/chrome', '--no-auto-import', '--no-headless']
    if action == 'serve':
        return common + ['--transport', 'stdio', '--no-daemon'] + list(extra)
    if action in ('login', 'status'):
        return common + ['--' + action] + list(extra)
    raise ValueError('Usage: career-ops-linkedin configure|login|status|serve')


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'serve'
    if action == 'configure' and len(sys.argv) == 2:
        configure()
        return
    # Credentials, session snapshots and browser state all stay under the
    # existing home volume. Do not import a host browser or share Indeed's profile.
    os.umask(0o077)
    # MCP stdio clients may forward only a small environment allowlist, omitting
    # DISPLAY even though the container's own shell has it. Use our actual Xvfb.
    os.environ.setdefault('DISPLAY', ':99')
    os.environ['LINKEDIN_MCP_CONTAINER'] = 'true'
    argv = invocation(action, sys.argv[2:])
    os.execv(argv[0], argv)


if __name__ == '__main__':
    main()
