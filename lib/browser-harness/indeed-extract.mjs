/** Runs inside the Indeed tab. Reads page data only; never clicks or submits. */
export function extractIndeedPage() {
  const body = (document.body?.innerText || '').slice(0, 250000);
  const title = document.title || '';
  const href = location.href;
  if (location.hostname !== 'www.indeed.com') {
    return { status: /accounts\.indeed\.com/.test(location.hostname) ? 'login_required' : 'unavailable', url: href };
  }
  if (/additional verification required|verify (?:that )?you are human|checking your browser|just a moment|access denied/i.test(title + '\n' + body.slice(0, 2000))) {
    return { status: 'challenge', url: href };
  }
  if (location.pathname === '/viewjob') {
    const description = document.querySelector('#jobDescriptionText, .simple-job-description-html')?.innerText?.trim();
    const closed = /this job has expired|no longer accepting applications|this job is no longer available/i.test(body);
    return {
      status: description || closed ? 'ok' : 'unavailable', url: href,
      title: document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], [data-testid="vj-job-title"]')?.innerText?.trim() || '',
      description: description || '',
      closed,
    };
  }
  const model = window.mosaic?.providerData?.['mosaic-provider-jobcards']?.metaData?.mosaicProviderJobCardsModel;
  // The bootstrap model can include unrelated recommendations or prefetched
  // pages. Only emit IDs present in the rendered results cards.
  const metadata = new Map((Array.isArray(model?.results) ? model.results : []).map(job => [job.jobkey, job]));
  const source = 'rendered-cards';
  const jobs = [...document.querySelectorAll('a.jcs-JobTitle[data-jk], h2.jobTitle a[data-jk], a[data-testid="job-title"][data-jk]')].map(link => {
    const card = link.closest('.job_seen_beacon, [data-testid="slider_item"], li');
    const id = link.getAttribute('data-jk');
    const data = metadata.get(id);
    return {
      id, title: link.innerText?.trim() || data?.displayTitle || data?.title,
      company: card?.querySelector('[data-testid="company-name"]')?.innerText?.trim() || data?.company,
      location: card?.querySelector('[data-testid="text-location"]')?.innerText?.trim() || data?.formattedLocation,
    };
  });
  // A loading shell or changed selector must not become a successful empty search.
  const empty = /did not match any jobs|no jobs found|no results found|couldn.t find any jobs/i.test(body);
  return { status: jobs.length ? 'ok' : empty ? 'empty' : 'unavailable', url: href, source, jobs };
}
