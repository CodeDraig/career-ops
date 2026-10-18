import assert from 'node:assert/strict';
import { pass, fail } from './helpers.mjs';
import { normalizeListing } from '../browser-extract.mjs';
try {
  const anchors = [
    { href: '#filters', label: 'REMOTE' },
    { href: '?sort=title', label: 'Posting Number' },
    { href: '/login', label: 'Login to Apply /Create Account' },
    { href: '/interest_cards', label: 'Job Alerts' },
    { href: '/talentnetwork/', label: 'Join Our Talent Network' },
    { href: '/jobs/122/nursing', label: 'More Info', buttonTitle: 'Job #122 - Nursing Instructor' },
    { href: '/jobs/123/math', label: 'More Info', cardTitle: 'Math Instructor' },
    { href: '/jobs/124/writing', label: 'More Info', buttonTitle: 'Job #999 - Wrong Neighbour' },
    { href: '/jobs/125/ambiguous', label: 'More Info' },
    { href: '/jobs/126/history', label: 'READ MORE ABOUT\n "History Faculty"' },
    { href: '/postings/99', label: 'Composition Faculty' },
    { href: '/postings/99', label: 'View Details' },
    { href: '/bookmarks?posting_id=99', label: 'Bookmark' },
  ];
  const jobs = normalizeListing(anchors, 'https://jobs.example.edu/postings/search').jobs;
  assert.deepEqual(jobs.map(j => j.title), ['Nursing Instructor', 'Math Instructor', 'History Faculty', 'Composition Faculty']);
  assert.equal(normalizeListing(anchors, 'https://jobs.example.edu/postings/search', 1).jobs[0].title, 'Nursing Instructor');
  const queryJobs = normalizeListing([
    { href: '?JobOpeningId=123', label: 'Faculty Position' },
    { href: '#/jobs/456', label: 'Teaching Position' },
    { href: '#filters', label: 'Filter Jobs' },
    { href: '?sort=title', label: 'Job Title' },
  ], 'https://jobs.example.edu/search');
  assert.equal(queryJobs.jobs.length, 2);
  pass('Listing titles use matching button metadata or card headings, excluding navigation and ambiguous buttons before the cap');
  pass('Listing filters preserve query-based and hash-routed job identities');
} catch (e) { fail(`Browser listing cards: ${e.stack}`); }
