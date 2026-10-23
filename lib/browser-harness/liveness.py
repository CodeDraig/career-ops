# Read-only posting liveness page snapshot through the connected Chrome extension.
# No page JavaScript, clicking, input, debugger, or user-tab reuse.

import json
import time
from urllib.parse import urlparse

target = None
result = None
try:
    caps = browser_capabilities()
    if caps.get('backend') != 'extension' or caps.get('browser') != 'chrome' or not caps.get('read_page'):
        result = {'status': 'unsupported_browser'}
        raise RuntimeError('unsupported_browser')

    requested = request['url']
    parsed = urlparse(requested)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        result = {'status': 'invalid_url'}
        raise RuntimeError('invalid_url')

    # The extension backend accepts only HTTP(S) new-tab URLs and creates a
    # fresh task-owned Chrome tab for each call, even if a blank user tab exists.
    target = new_tab(requested)
    switch_tab(target)
    deadline = time.monotonic() + 20
    last = None
    while True:
        current = current_tab()
        if current.get('targetId') != target:
            raise RuntimeError('selected_tab_changed')
        page = read_page(include_frames=False)
        body = page.get('text', '')
        title = page.get('title', '')
        final_url = current.get('url') or page.get('url') or requested
        controls = [str(control.get('label') or '') for control in page.get('controls', [])]
        controls.extend(str(link.get('text') or '') for link in page.get('links', []))
        result = {'status': 'page', 'url': final_url, 'targetId': target, 'title': title[:1000], 'text': body[:250000], 'controls': controls[:2000]}

        # Apply/closure language can become decisive before the rest of a SPA
        # finishes loading. Otherwise wait for useful page text, bounded to 20s.
        lowered = (title + '\n' + body[:3000]).lower()
        challenge = any(marker in lowered for marker in ('just a moment', 'verify you are human', 'checking your browser', 'security verification', 'access denied'))
        enough = len(body.strip()) >= 300
        if challenge or enough or time.monotonic() >= deadline:
            break
        if last == (final_url, body):
            time.sleep(0.5)
        else:
            last = (final_url, body)
            time.sleep(0.5)
except Exception:
    if not result or result.get('status') != 'unsupported_browser':
        result = {'status': result.get('status') if result and result.get('status') != 'page' else 'browser_unavailable'}
finally:
    print('CAREER_OPS_LIVENESS=' + json.dumps(result or {'status': 'browser_unavailable'}))
