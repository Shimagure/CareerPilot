const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const url = 'https://www.bossjob.ph/en-us/onsite-job?q=IT+Support&location=Metro+Manila';
const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
const html = await res.text();

// The streaming data is in script tags, each with a push call
// Let's extract all script content
const scripts = html.match(/<script>self\.__next_f\.push\(\[1,[^\]]+\]\)<\/script>/g);
console.log('Script pushes:', scripts ? scripts.length : 0);

// Better: find all self.__next_f.push calls
const allPushes = [];
const regex = /self\.__next_f\.push\((\[.*?\])\)/g;
let match;
while ((match = regex.exec(html)) !== null) {
  allPushes.push(match[1]);
}
console.log('Total push arrays:', allPushes.length);

// For each push array, try to parse it
for (let i = 0; i < allPushes.length; i++) {
  const arrStr = allPushes[i];
  try {
    const arr = JSON.parse(arrStr);
    if (Array.isArray(arr) && arr.length >= 2) {
      const type = arr[0];
      const content = arr[1];
      if (typeof content === 'string' && (content.includes('job_id') || content.includes('job_title') || content.includes('jobs'))) {
        console.log('--- Push', i, 'type:', type, '---');
        console.log(content.slice(0, 500));
      }
    }
  } catch (e) {
    // Skip parse errors
  }
}