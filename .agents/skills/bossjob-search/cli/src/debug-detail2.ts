const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/job/536344';
const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow'
});
const html = await res.text();

// look around salary_info at 713569 (note the escaped context shows \\\" for deeper nesting)
const start = 713569;
console.log('--- around salary_info ---');
console.log(JSON.stringify(html.slice(start - 500, start + 800)));
