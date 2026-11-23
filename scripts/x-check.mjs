// Checks the four X keys by asking X which account they belong to. Posts nothing.
//
//   X_API_KEY=... X_API_SECRET=... X_ACCESS_TOKEN=... X_ACCESS_TOKEN_SECRET=... node scripts/x-check.mjs
//
// The keys come from the app's page in the X developer portal (Keys and tokens).
// Generate the Access Token after setting the app's permissions to Read and
// Write, or posting is refused with a 403.

import { hasCredentials, login } from './lib/x.mjs';

if (!hasCredentials()) {
  console.error('Set X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and X_ACCESS_TOKEN_SECRET.');
  process.exit(1);
}
const x = await login();
console.log(`The keys belong to @${x.username} (${x.id}).`);
