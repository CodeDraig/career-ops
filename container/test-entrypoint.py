"""Offline regressions for persistent state and graceful browser shutdown."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('entrypoint', Path(__file__).with_name('entrypoint.py'))
entrypoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entrypoint)


class StartupTests(unittest.TestCase):
    def test_serve_owns_both_profiles_and_recovers_linkedin_before_any_client_starts(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            profile = home / '.linkedin-mcp/profile'
            profile.mkdir(parents=True)
            (profile / 'Cookies').write_bytes(b'LinkedIn authentication fixture')
            (profile / 'SingletonLock').symlink_to('previous-container-123')

            def stop_before_services():
                self.assertFalse((profile / 'SingletonLock').is_symlink())
                self.assertEqual((profile / 'Cookies').read_bytes(), b'LinkedIn authentication fixture')
                for current in (home / 'chrome-profile', profile):
                    with self.assertRaisesRegex(RuntimeError, 'already owned'):
                        entrypoint.acquire_profile(current)
                raise RuntimeError('stop before launching services')

            with patch.object(entrypoint.Path, 'home', return_value=home), \
                    patch.object(entrypoint.signal, 'signal'), \
                    patch.object(entrypoint, 'prepare', side_effect=stop_before_services):
                with self.assertRaisesRegex(RuntimeError, 'stop before launching services'):
                    entrypoint.serve()
            # Both guards are released on failure, including the first when the
            # second profile or later preparation fails.
            for current in (home / 'chrome-profile', profile):
                with entrypoint.acquire_profile(current):
                    pass

    def test_previous_container_locks_are_archived_without_changing_profile_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = root / 'profile'
            profile.mkdir()
            (profile / 'Cookies').write_bytes(b'persistent cookie fixture')
            (profile / 'SingletonLock').symlink_to('previous-host-42')
            (profile / 'SingletonSocket').symlink_to('/tmp/previous-chrome/SingletonSocket')
            archive = root / 'archives'
            with entrypoint.acquire_profile(profile, archive):
                self.assertFalse((profile / 'SingletonLock').is_symlink())
                self.assertFalse((profile / 'SingletonSocket').is_symlink())
                self.assertEqual((profile / 'Cookies').read_bytes(), b'persistent cookie fixture')
                receipt = next(archive.glob('*/receipt.json'))
                self.assertEqual(json.loads(receipt.read_text())['SingletonLock'], 'previous-host-42')
                self.assertEqual(os.readlink(receipt.parent / 'SingletonSocket'), '/tmp/previous-chrome/SingletonSocket')

    def test_second_container_cannot_recover_the_running_browser_locks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with entrypoint.acquire_profile(root / 'profile', root / 'archives'):
                (root / 'profile/SingletonLock').symlink_to('running-host-42')
                with self.assertRaisesRegex(RuntimeError, 'already owned'):
                    entrypoint.acquire_profile(root / 'profile', root / 'archives')
                self.assertEqual(os.readlink(root / 'profile/SingletonLock'), 'running-host-42')
                self.assertFalse((root / 'archives').exists())

    def test_prepare_keeps_user_data_and_existing_pairing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            config = home / '.config/browser-harness'
            config.mkdir(parents=True)
            pairing = b'{"token":"existing-private-fixture","port":8766}'
            (config / 'extension.json').write_bytes(pairing)
            data = root / 'data'
            data.mkdir()
            (data / 'cv.md').write_bytes(b'User-authored CV\n')
            env = {'HOME': str(home), 'CAREER_OPS_ROOT': str(data), 'BH_CONFIG_DIR': str(config),
                   'BH_RUNTIME_DIR': str(root / 'run'), 'BH_TMP_DIR': str(root / 'tmp')}
            with patch.dict(os.environ, env), patch.object(entrypoint.subprocess, 'run') as run:
                entrypoint.prepare()
            self.assertEqual((data / 'cv.md').read_bytes(), b'User-authored CV\n')
            self.assertEqual((config / 'extension.json').read_bytes(), pairing)
            self.assertEqual(sorted(p.name for p in data.iterdir()), ['cv.md'])
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[0][:4], ['browser-harness', 'extension', 'install-host', 'chrome'])
            self.assertEqual(run.call_args_list[1].args[0], ['career-ops-linkedin', 'configure'])

    def test_chrome_flushes_before_display_is_stopped(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            display = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'], start_new_session=True)
            program = '''import json,os,signal,sys,time
from pathlib import Path
root=Path(sys.argv[1]); display=int(sys.argv[2])
def stop(*args):
 os.kill(display,0)
 (root/'flushed.json').write_text(json.dumps({'display_alive':True}))
 sys.exit(0)
signal.signal(signal.SIGTERM,stop)
(root/'ready').touch()
while True:time.sleep(.1)
'''
            chrome = subprocess.Popen([sys.executable, '-c', program, str(root), str(display.pid)], start_new_session=True)
            try:
                for _ in range(100):
                    if (root / 'ready').exists():
                        break
                    time.sleep(.01)
                self.assertTrue((root / 'ready').exists())
                entrypoint.shutdown([('display', display), ('Chrome', chrome)])
                self.assertEqual(chrome.returncode, 0)
                self.assertTrue(json.loads((root / 'flushed.json').read_text())['display_alive'])
                self.assertIsNotNone(display.poll())
            finally:
                for process in (chrome, display):
                    if process.poll() is None:
                        process.kill()
                        process.wait()


if __name__ == '__main__':
    unittest.main()
