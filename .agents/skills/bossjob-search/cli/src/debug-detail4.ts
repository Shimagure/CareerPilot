const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/job/536344';
const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow'
});
const html = await res.text();

// The escaped JSON uses \\" for quotes
const patterns = [
  '\\"job_detail\\":{',
  '\\\\"job_detail\\\\":{',
  '\\\\\\"job_detail\\\\\\":{',
];
for (const p of patterns) {
  console.log(JSON.stringify(p), '=>', html.indexOf(p));
}

// Check raw bytes around job_detail at 736505
const slice = html.slice(736455, 736555);
console.log('\nRaw slice char codes:', [...slice].map(c => c.charCodeAt(0)).join(','));