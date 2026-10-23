"""Run the app and its desktop as one unprivileged, supervised process group."""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

CODE = Path('/opt/career-ops')
ADDON = Path('/opt/browser-harness/chrome-extension')


def acquire_profile(profile=None, archive_root=None):
    """Own this dedicated profile across PID namespaces before recovering locks.

    Chromium's singleton links point into the previous container's /tmp and
    contain its hostname/PID. They aren't portable persistent browser state.
    The advisory lock is shared by every instance of this entrypoint, so a
    second container cannot recover links belonging to a running first one.
    """
    profile = profile or Path.home() / 'chrome-profile'
    profile.mkdir(parents=True, exist_ok=True)
    guard = os.fdopen(os.open(profile / '.career-ops-owner.lock', os.O_CREAT | os.O_RDWR, 0o600), 'a')
    try:
        fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        links = [profile / name for name in ('SingletonLock', 'SingletonSocket', 'SingletonCookie')
                 if (profile / name).is_symlink()]
        if links:
            archive_root = archive_root or Path.home() / '.local/state/career-ops/chrome-locks'
            destination = archive_root / str(time.time_ns())
            destination.mkdir(parents=True)
            receipt = {}
            for link in links:
                receipt[link.name] = os.readlink(link)
                link.rename(destination / link.name)
            (destination / 'receipt.json').write_text(json.dumps(receipt, indent=2))
            print('Preserved previous Chrome runtime links in ' + str(destination), flush=True)
        return guard
    except BlockingIOError:
        guard.close()
        raise RuntimeError('Chrome profile is already owned by another Career-Ops container') from None
    except Exception:
        guard.close()
        raise


def extension_id(directory=ADDON):
    return ''.join(chr(ord('a') + int(c, 16)) for c in hashlib.sha256(str(directory).encode()).hexdigest()[:32])


def wait_port(port, process, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Service exited before port {port} became ready')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                return
        except OSError:
            time.sleep(.1)
    raise RuntimeError(f'Timed out waiting for port {port}')


def prepare():
    for directory in (Path(os.environ['CAREER_OPS_ROOT']), Path.home() / 'chrome-profile',
                      Path(os.environ['BH_CONFIG_DIR']), Path(os.environ['BH_RUNTIME_DIR']),
                      Path(os.environ['BH_TMP_DIR'])):
        directory.mkdir(parents=True, exist_ok=True)
        if not os.access(directory, os.W_OK):
            raise RuntimeError(f'{directory} must be writable by container uid {os.getuid()}')
    config = Path(os.environ['BH_CONFIG_DIR']) / 'extension.json'
    if not config.exists():
        subprocess.run(['browser-harness', 'extension', 'configure'], check=True)
    subprocess.run(['browser-harness', 'extension', 'install-host', 'chrome',
                    '--extension-id', extension_id(), '--manifest-dir',
                    str(Path.home() / 'chrome-profile/NativeMessagingHosts')], check=True)
    subprocess.run(['career-ops-linkedin', 'configure'], check=True)


def shutdown(children):
    # Keep the display and native bridge alive while Chrome flushes its profile.
    ordered = sorted(children, key=lambda item: item[0] != 'Chrome')
    for name, process in ordered:
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
            if name == 'Chrome':
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
    deadline = time.monotonic() + 15
    for _, process in ordered:
        try:
            process.wait(timeout=max(.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


def serve():
    children = []
    stopping = False
    guards = []

    def stop(signum=None, frame=None):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def start(name, argv, **kwargs):
        process = subprocess.Popen(argv, start_new_session=True, **kwargs)
        children.append((name, process))
        return process

    try:
        guards.append(acquire_profile())
        guards.append(acquire_profile(Path.home() / '.linkedin-mcp/profile',
                                      Path.home() / '.local/state/career-ops/linkedin-locks'))
        prepare()
        display = os.environ.get('DISPLAY', ':99')
        start('display', ['Xvfb', display, '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'])
        for _ in range(100):
            if subprocess.run(['xdpyinfo'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(.1)
        else:
            raise RuntimeError('Virtual display did not start')
        start('window manager', ['openbox'])
        vnc = start('VNC', ['x11vnc', '-display', display, '-localhost', '-forever', '-shared', '-nopw', '-rfbport', '5900'])
        wait_port(5900, vnc)
        start('desktop web', ['websockify', '--web=/usr/share/novnc', '0.0.0.0:6080', '127.0.0.1:5900'])
        broker = start('Browser Harness', ['python', '-m', 'browser_harness.daemon'])
        # Ping its Unix IPC rather than opening an invalid WebSocket handshake.
        from browser_harness import _ipc
        for _ in range(100):
            if broker.poll() is not None:
                raise RuntimeError('Browser Harness exited during startup')
            try:
                connection, token = _ipc.connect(os.environ['BU_NAME'], timeout=.2)
                try:
                    ready = _ipc.request(connection, token, {'meta': 'ping'})
                finally:
                    connection.close()
                if ready.get('backend') == 'extension':
                    break
            except OSError:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Browser Harness did not start')
        profile = Path.home() / 'chrome-profile'
        chrome = start('Chrome', ['google-chrome', '--user-data-dir=' + str(profile),
                        '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage',
                        '--load-extension=' + str(ADDON), '--window-size=1440,1000',
                        'about:blank'])
        # An extension URL passed to Chrome's initial launch can race extension
        # registration and become ERR_BLOCKED_BY_CLIENT. Wait for its storage.
        extension_storage = profile / 'Default/Local Extension Settings' / extension_id()
        deadline = time.monotonic() + 30
        while not extension_storage.exists():
            if chrome.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError('Chrome did not load Browser Harness')
            time.sleep(.1)
        subprocess.run(['xdotool', 'search', '--sync', '--onlyvisible', '--class', 'Chromium-browser'],
                       check=True, timeout=30, stdout=subprocess.DEVNULL)
        subprocess.run(['google-chrome', '--user-data-dir=' + str(profile),
                        'chrome-extension://' + extension_id() + '/popup.html'], check=True, timeout=10)
        start('web', ['npm', '--prefix', str(CODE / 'web'), 'start', '--', '--hostname', '0.0.0.0', '--port', '3000'])
        print('Career-Ops: web on :3000; desktop on :6080/vnc.html. Connect Browser Harness in Chrome.', flush=True)
        while not stopping:
            for name, process in children:
                if process.poll() is not None:
                    raise RuntimeError(f'{name} exited ({process.returncode})')
            time.sleep(.25)
        return 0
    finally:
        shutdown(children)
        for guard in reversed(guards):
            guard.close()


if __name__ == '__main__':
    try:
        if sys.argv[1:] != ['serve']:
            os.execvp(sys.argv[1], sys.argv[1:])
        sys.exit(serve())
    except Exception as error:
        print(f'Career-Ops startup failed: {error}', file=sys.stderr)
        sys.exit(1)
