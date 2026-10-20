# Public search snapshots through the extension; never js, CDP or input calls.
import json
import time
from urllib.parse import urlparse

pages = []
owned = []
try:
    caps = browser_capabilities()
    if caps.get('backend') != 'extension' or not caps.get('read_page'):
        raise RuntimeError('Browser Harness extension is not connected')
    url = request['url']
    origin = urlparse(url).netloc
    visited = set()
    for number in range(1, request['maxPages'] + 1):
        if url in visited or urlparse(url).netloc != origin or urlparse(url).scheme != 'https' or (request['kind'] == 'hca' and not urlparse(url).path.rstrip('/').endswith(('/search/galen-college-of-nursing/jobs', '/search/galen-college-of-nursing/jobs/in'))):
            raise RuntimeError('Repeated page or foreign employer pagination')
        visited.add(url)
        target = new_tab(url)
        owned.append(target)
        switch_tab(target)
        deadline = time.monotonic() + 20
        while True:
            if current_tab()['targetId'] != target:
                raise RuntimeError('Selected browser tab changed')
            snapshot = read_page()
            text = snapshot.get('text', '')
            if ('Showing ' in text or 'Position ID:' in text or
                'blocked' in text.lower() or 'not authorized' in text.lower() or
                time.monotonic() >= deadline):
                break
            time.sleep(0.5)
        pages.append(snapshot)
        next_links = [l for l in snapshot.get('links', []) if l.get('text', '').strip() in ('chevron_right', 'Next', 'Next ›', 'Next »')]
        if request['kind'] == 'interviewexchange' or not next_links:
            break
        url = next_links[0]['url'].split('#')[0]
    else:
        raise RuntimeError('Page limit reached; incomplete results')
    print('CAREER_OPS_COLLEGE=' + json.dumps({'pages': pages}))
except Exception as error:
    print('CAREER_OPS_COLLEGE=' + json.dumps({'error': str(error)}))
finally:
    # Only task-created tabs; never close an existing user tab.
    for target in owned:
        try:
            switch_tab(target)
            close_tab(target)
        except Exception:
            pass
