// Live verification - fetch job details from URLs
const fs = require('fs');

const jobs = JSON.parse(fs.readFileSync('.scrape_out/needs_verification_dedup.json', 'utf8').replace(/^﻿/, ''));

console.log(`Starting live verification for ${jobs.length} jobs...`);
console.log('This will fetch details from each job URL to verify the posting is still active and get full description.');

// We'll use WebFetch tool via the agent to do this
// For now, let's prepare the URLs for verification

const urls = jobs.map(j => ({
  stable_id: j.stable_id,
  title: j.title,
  company: j.company,
  url: j.url,
  source_file: j.source_file
}));

fs.writeFileSync('.scrape_out/verification_urls.json', JSON.stringify(urls, null, 2));
console.log(`Prepared ${urls.length} URLs for verification`);
console.log('URLs saved to .scrape_out/verification_urls.json');