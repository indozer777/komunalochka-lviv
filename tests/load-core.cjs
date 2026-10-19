const fs = require('node:fs');
const path = require('node:path');
const loaded = { exports: {} };
new Function('module', 'exports', fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8'))(loaded, loaded.exports);
module.exports = loaded.exports;
