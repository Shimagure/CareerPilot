const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/job/536344';
const res = await fetch(url, {
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
  redirect: 'follow'
});
const html = await res.text();

// Search all occurrences of job_detail
let pos = html.indexOf('job_detail');
while (pos !== -1) {
  console.log('job_detail at', pos, 'context:', JSON.stringify(html.slice(pos-5, pos+15)));
  pos = html.indexOf('job_detail', pos+1);
}