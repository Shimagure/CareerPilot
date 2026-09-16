const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// Look at ALL pushes, not just filtered ones
const pushes = [];
let match;
const regex = /self\.__next_f\.push\(\[1,"([^"]*)"\/\\\\\]\)/g;
while ((match = regex.exec(html)) !== null) {
  pushes.push(match[1]);
}

console.log('Total pushes:', pushes.length);
for (let i = 0; i < pushes.length; i++) {
  const content = pushes[i];
  if (content.length > 100) {
    console.log('--- Push', i, 'length:', content.length, '---');
    console.log(content.slice(0, 300));
    console.log('...');
  }
}

// Now let's try to find the one with job data by looking at the unescaped version
console.log('\n=== Checking unescaped for job data ===');
for (let i = 0; i < pushes.length; i++) {
  const content = pushes[i];
  let unescaped = content
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\u0026/g, '&');
  if (unescaped.includes('job_id') || unescaped.includes('job_title')) {
    console.log('--- Push', i, 'has job data ---');
    console.log(unescaped.slice(0, 500));
  }
}