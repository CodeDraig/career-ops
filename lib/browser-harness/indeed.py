# Executed by browser-harness with BH_BACKEND=extension. request is JSON data.
import json
import time

target = None
result = None
try:
    capabilities = browser_capabilities()
    if capabilities.get('backend') != 'extension' or capabilities.get('browser') != 'chrome' or not capabilities.get('js'):
        result = {'status': 'unsupported_browser'}
        raise RuntimeError('unsupported_browser')
    # The extension requires an HTTP(S) URL and always creates a new tab.
    target = new_tab(request['url'])
    switch_tab(target)
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if current_tab()['targetId'] != target:
            raise RuntimeError('tab_changed')
        result = js(request['expression'])
        if isinstance(result, dict) and result.get('status') in ('ok', 'empty', 'challenge', 'login_required'):
            break
        time.sleep(0.5)
    if not isinstance(result, dict):
        result = {'status': 'unavailable'}
except Exception:
    if not result or result.get('status') != 'unsupported_browser':
        result = {'status': 'browser_unavailable'}
finally:
    # Leave challenge/login tabs available for the human, without clicking them.
    if target and result and result.get('status') in ('ok', 'empty'):
        try:
            if current_tab()['targetId'] == target:
                close_tab(target)
        except Exception:
            pass  # Never close a different tab or replay uncertain commands.
    print('CAREER_OPS_INDEED=' + json.dumps(result))
