import { readFileSync } from 'fs';

// Read the saved output
const output = readFileSync('C:\\Users\\Soladm\\.claude\\projects\\C--Users-Soladm-Downloads-Pilot-ai-job-search\\591fdaf0-8296-464e-82d0-98d13c97d5b2\\tool-results\\bzyra2yq7.txt', 'utf8');

// Split into lines
const lines = output.split('\n');
console.log('Total lines:', lines.length);

// Find pushes with job data
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('job_id') || lines[i].includes('job_title') || lines[i].includes('jobs')) {
    console.log('Line', i, ':', lines[i].slice(0, 300));
    console.log('---');
  }
}