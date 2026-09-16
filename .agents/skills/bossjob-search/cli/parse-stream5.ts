import { readFileSync } from 'fs';

const output = readFileSync('C:\\Users\\Soladm\\.claude\\projects\\C--Users-Soladm-Downloads-Pilot-ai-job-search\\591fdaf0-8296-464e-82d0-98d13c97d5b2\\tool-results\\bzyra2yq7.txt', 'utf8');

const lines = output.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Captain Waiter') || lines[i].includes('Accountant') || lines[i].includes('Cashier') || lines[i].includes('Presales') || lines[i].includes('Accounting') || lines[i].includes('Sales and Marketing') || lines[i].includes('Call Center') || lines[i].includes('Accounting Officer') || lines[i].includes('Operations Manager')) {
    console.log('Line', i, ':', lines[i].slice(0, 500));
    console.log('---');
  }
}