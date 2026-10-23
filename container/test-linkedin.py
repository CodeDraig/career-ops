"""Registration must be persistent and must not replace user configuration."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('linkedin', Path(__file__).with_name('linkedin.py'))
linkedin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(linkedin)


class LinkedInTests(unittest.TestCase):
    def test_registers_only_when_absent(self):
        with patch.object(linkedin.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '[]')) as run:
            self.assertTrue(linkedin.configure())
        self.assertEqual(run.call_args_list[1].args[0],
                         ['codex', 'mcp', 'add', 'linkedin', '--', linkedin.COMMAND, 'serve'])

    def test_preserves_existing_registration_including_disabled_servers(self):
        for server in ({'name': 'linkedin', 'enabled': True}, {'name': 'linkedin', 'enabled': False}):
            with self.subTest(server=server), patch.object(linkedin.subprocess, 'run',
                    return_value=subprocess.CompletedProcess([], 0, json.dumps([server]))) as run:
                self.assertFalse(linkedin.configure())
                self.assertEqual(run.call_count, 1)

    def test_does_not_overwrite_after_failed_inspection(self):
        with patch.object(linkedin.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'codex')) as run:
            with self.assertRaises(subprocess.CalledProcessError):
                linkedin.configure()
            self.assertEqual(run.call_count, 1)

    def test_login_and_mcp_use_the_same_persistent_separate_profile(self):
        for action in ('login', 'status', 'serve'):
            command = linkedin.invocation(action)
            self.assertEqual(command[command.index('--user-data-dir') + 1], str(Path.home() / '.linkedin-mcp/profile'))
            self.assertIn('--no-auto-import', command)
            self.assertIn('--no-headless', command)
        self.assertIn('--no-daemon', linkedin.invocation('serve'))
        self.assertIn('--login', linkedin.invocation('login'))

    def test_stdio_clients_that_filter_display_still_reach_the_desktop(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(linkedin.sys, 'argv', ['career-ops-linkedin', 'serve']), \
                patch.object(linkedin.os, 'umask'), patch.object(linkedin.os, 'execv') as execute:
            linkedin.main()
            self.assertEqual(os.environ['DISPLAY'], ':99')
            self.assertEqual(os.environ['LINKEDIN_MCP_CONTAINER'], 'true')
            self.assertEqual(execute.call_args.args[0], linkedin.SERVER)


if __name__ == '__main__':
    unittest.main()
