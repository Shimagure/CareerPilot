const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/job/536344';
const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow'
});
const html = await res.text();
console.log('HTML length:', html.length);

for (const s of ['job_title', 'job_detail', 'company_name', 'salary_info', 'description_html', 'jobDetail', 'job_header', 'requirement_html']) {
  const idx = html.indexOf(s);
  console.log(s, '=>', idx === -1 ? 'NOT FOUND' : 'found at ' + idx);
}

// context around job_detail
const jd = html.indexOf('job_detail');
if (jd !== -1) console.log('\n--- job_detail context ---\n', JSON.stringify(html.slice(jd - 20, jd + 600)));
