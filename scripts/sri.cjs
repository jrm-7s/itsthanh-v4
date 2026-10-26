// Prints the Subresource Integrity hashes for the files Webflow loads from jsDelivr.
// Run after `npm run build`, then paste them into the integrity="" attributes (see README).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

for (const f of ['dist/v4.min.js', 'dist/v4.min.css']) {
  const buf = fs.readFileSync(path.join(__dirname, '..', f));
  console.log(`${f}\n  sha384-${crypto.createHash('sha384').update(buf).digest('base64')}`);
}
