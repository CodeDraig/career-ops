"""Exercise the patched MCP reader in Chromium, without LinkedIn/network access.

Run inside the built image: /opt/linkedin/bin/python container/test-linkedin-apply.py
"""
import copy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock

from patchright.async_api import async_playwright
from linkedin_mcp_server.linkedin import job_pages
from linkedin_mcp_server.linkedin.session import PageSession
from linkedin_mcp_server.linkedin.text import JOB_APPLY_EN_US

URL = 'https://www.linkedin.com/jobs/view/123/'
BUTTON = '<button aria-label="Apply on company website">Apply</button>'
RECORD = {'entityUrn': 'urn:li:fs_normalized_jobPosting:123',
          'applyingInfo': {'entityUrn': 'urn:li:fs_jobApplyingInfo:123', 'applied': False, 'closed': False},
          'applyMethod': {'com.linkedin.voyager.jobs.OffsiteApply': {'companyApplyUrl': 'https://employer.example/jobs/42'}}}


class ApplyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.driver = await async_playwright().start()
        self.browser = await self.driver.chromium.launch(executable_path='/opt/chrome-linux64/chrome', headless=True)
        self.context = await self.browser.new_context()
        await self.context.add_cookies([{'name': 'JSESSIONID', 'value': '"fixture-csrf"', 'domain': 'www.linkedin.com', 'path': '/'}])
        self.page = await self.context.new_page()
        self.requests = []
        self.record = copy.deepcopy(RECORD)
        self.status = 200
        self.html = '<main>' + BUTTON + '<h2>About the job</h2><p>Posting</p></main>'
        async def respond(route):
            request = route.request
            self.requests.append((request.method, request.url))
            if request.url == URL:
                await route.fulfill(content_type='text/html', body=self.html)
            elif request.url == 'https://www.linkedin.com/voyager/api/jobs/jobPostings/123':
                self.assertEqual(request.headers['csrf-token'], 'fixture-csrf')
                await route.fulfill(status=self.status, content_type='application/json', body=json.dumps(self.record))
            else:
                self.fail('Unexpected request: ' + request.url)
        await self.context.route('**/*', respond)
        async def navigate(url):
            await self.page.goto(url)
        navigator = SimpleNamespace(_navigate_to_page=AsyncMock(side_effect=navigate),
                                    _raise_if_auth_barrier=AsyncMock())
        # Keep the real document-origin guard, without unrelated rate-limit UI.
        session = SimpleNamespace(page=self.page, check_rate_limit=AsyncMock(),
                                  run_on_linkedin=PageSession(self.page).run_on_linkedin)
        self.reader = job_pages.JobPageReader(session, navigator, None)
        self.old_timeout = job_pages._APPLY_READY_TIMEOUT
        job_pages._APPLY_READY_TIMEOUT = 0.1

    async def asyncTearDown(self):
        job_pages._APPLY_READY_TIMEOUT = self.old_timeout
        await self.browser.close()
        await self.driver.stop()

    async def read(self):
        return await self.reader.read_apply_link(URL, '123', JOB_APPLY_EN_US)

    async def test_button_reads_exact_record_without_clicks_posts_or_employer_navigation(self):
        result = await self.read()
        self.assertEqual((result.type, result.url), ('external', 'https://employer.example/jobs/42'))
        self.assertEqual(self.requests, [('GET', URL), ('GET', 'https://www.linkedin.com/voyager/api/jobs/jobPostings/123')])

    async def test_existing_link_and_easy_apply_need_no_api(self):
        for control, expected in [('<a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Femployer.example%2Fjob">Apply</a>', 'external'),
                                  ('<button>Easy Apply</button>', 'easy_apply')]:
            self.html = '<main>' + control + '<h2>About the job</h2></main>'
            self.requests.clear()
            self.assertEqual((await self.read()).type, expected)
            self.assertEqual(self.requests, [('GET', URL)])

    async def test_similar_jobs_and_missing_description_cannot_trigger_lookup(self):
        for html in ['<main><h2>About the job</h2>' + BUTTON + '</main>', '<main>' + BUTTON + '</main>']:
            self.html = html
            self.requests.clear()
            self.assertEqual((await self.read()).type, 'unknown')
            self.assertEqual(self.requests, [('GET', URL)])

    async def test_api_states_take_precedence_over_destination(self):
        for state in ('applied', 'closed'):
            self.record = copy.deepcopy(RECORD)
            self.record['applyingInfo'][state] = True
            self.assertEqual((await self.read()).type, state)

    async def test_visible_applied_and_closed_states_need_no_api(self):
        for text, state in [('Application submitted', 'applied'), ('No longer accepting applications', 'closed')]:
            self.html = '<main><p>' + text + '</p>' + BUTTON + '<h2>About the job</h2></main>'
            self.requests.clear()
            self.assertEqual((await self.read()).type, state)
            self.assertEqual(self.requests, [('GET', URL)])

    async def test_mismatched_records_missing_state_and_http_errors_remain_unknown(self):
        for field in ('entityUrn', 'applyingInfo'):
            self.record = copy.deepcopy(RECORD)
            self.record[field] = None
            self.assertEqual((await self.read()).type, 'unknown')
        self.record = copy.deepcopy(RECORD)
        self.record['applyingInfo']['entityUrn'] = 'urn:li:fs_jobApplyingInfo:999'
        self.assertEqual((await self.read()).type, 'unknown')
        self.record = copy.deepcopy(RECORD)
        self.status = 403
        self.assertEqual((await self.read()).type, 'unknown')

    async def test_private_destination_is_not_returned(self):
        self.record['applyMethod']['com.linkedin.voyager.jobs.OffsiteApply']['companyApplyUrl'] = 'http://127.0.0.1/private'
        result = await self.read()
        self.assertEqual(result.type, 'external')
        self.assertIsNone(result.url)

    async def test_different_posting_or_missing_csrf_never_fetches(self):
        await self.page.goto(URL)
        await self.page.evaluate("history.replaceState({}, '', '/jobs/view/999/')")
        self.requests.clear()
        self.assertIsNone(await PageSession(self.page).run_on_linkedin(job_pages.APPLY_RECORD_JS, '123'))
        self.assertEqual(self.requests, [])
        await self.page.goto(URL)
        await self.context.clear_cookies()
        self.requests.clear()
        self.assertIsNone(await PageSession(self.page).run_on_linkedin(job_pages.APPLY_RECORD_JS, '123'))
        self.assertEqual(self.requests, [])


if __name__ == '__main__':
    unittest.main()
