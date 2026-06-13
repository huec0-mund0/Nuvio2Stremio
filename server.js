/**
 * Local server for Nuvio Streams Stremio Addon
 * Run: node server.js
 * Install in Stremio: http://localhost:7000/manifest.json
 * Or via ngrok for external access
 */

const express = require('express');
const addonHandler = require('./api/addon');

const app = express();
const PORT = process.env.PORT || 7000;

// Mount the serverless handler
app.use((req, res) => {
  addonHandler(req, res);
});

app.listen(PORT, () => {
  console.log(`Nuvio Streams addon running at http://localhost:${PORT}/manifest.json`);
});
