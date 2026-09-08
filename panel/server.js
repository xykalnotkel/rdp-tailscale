#!/usr/bin/env node
/* Kall Desktop Control - server lokal (Node 18+). Untuk Vercel pakai api/[slug].js */
'use strict';

const http = require('http');
const { handler, REPO, BRANCH, TOKEN, PANEL_KEY, ADMIN_PIN } = require('./core');
const PORT = Number(process.env.PORT || 3000);

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
  console.log('Kall Desktop Control panel jalan di http://0.0.0.0:' + PORT);
  console.log('Repo : ' + (REPO || '(kosong - set GITHUB_REPO)') + '  branch: ' + BRANCH);
  console.log('Token: ' + (TOKEN ? 'ada' : 'TIDAK ADA') + ' | PANEL_KEY: ' + (PANEL_KEY ? 'ada' : 'TIDAK ADA') + ' | PIN: ' + (ADMIN_PIN ? 'ada' : 'tidak'));
});
