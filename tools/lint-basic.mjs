import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const roots = ['src', 'tools', 'tests'];
const errors = [];
for (const root of roots) await walk(root);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('basic lint passed');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    if (entry.isFile() && /\.(js|mjs|json|css|html)$/.test(entry.name)) await lintFile(path);
  }
}

async function lintFile(path) {
  const text = await readFile(path, 'utf8');
  if (/\t/.test(text)) errors.push(`${path}: tabs are not allowed`);
  if (!text.endsWith('\n')) errors.push(`${path}: missing trailing newline`);
  text.split('\n').forEach((line, index) => {
    if (/\s+$/.test(line)) errors.push(`${path}:${index + 1}: trailing whitespace`);
  });
}
