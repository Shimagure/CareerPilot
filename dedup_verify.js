// Deduplicate needs_verification by stable_id
const fs = require('fs');

const needsVerification = JSON.parse(fs.readFileSync('.scrape_out/needs_verification.json', 'utf8').replace(/^﻿/, ''));

const seen = new Map();
const deduped = [];
const duplicates = [];

for (const job of needsVerification) {
  if (seen.has(job.stable_id)) {
    duplicates.push(job);
  } else {
    seen.set(job.stable_id, job);
    deduped.push(job);
  }
}

console.log(`Total: ${needsVerification.length}, Unique: ${deduped.length}, Duplicates: ${duplicates.length}`);

if (duplicates.length > 0) {
  console.log('\nDuplicates found:');
  for (const d of duplicates) {
    console.log(`  - ${d.title} @ ${d.company} (stable_id: ${d.stable_id})`);
  }
}

// Write deduped list
fs.writeFileSync('.scrape_out/needs_verification_dedup.json', JSON.stringify(deduped, null, 2));