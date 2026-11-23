// Minimal Google Apps Script mocks to execute Code.gs in Node and run acceptance scenarios.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto');

function makeEnv(startIso) {
  let fakeNow = new Date(startIso).getTime();
  const RealDate = Date;
  class FDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(fakeNow); else super(...a); }
    static now() { return fakeNow; }
  }
  FDate.UTC = RealDate.UTC; FDate.parse = RealDate.parse;

  const sent = [];
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i] || []; out.push(Array.from({ length: this.nc }, (_, j) => row[this.c - 1 + j] ?? '')); } return out; }
    setValues(v) {
      if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues dims mismatch ${v.length}x${v[0].length} vs ${this.nr}x${this.nc} on ${this.sh.name}`);
      for (let i = 0; i < this.nr; i++) { const idx = this.r - 1 + i; this.sh.data[idx] = this.sh.data[idx] || []; for (let j = 0; j < this.nc; j++) { let x = v[i][j]; if (typeof x === 'string' && x.startsWith("'")) x = x.slice(1); this.sh.data[idx][this.c - 1 + j] = x; } }
      return this;
    }
    setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getLastRow() { let n = this.data.length; while (n > 0 && (!this.data[n - 1] || this.data[n - 1].every(x => x === '' || x == null))) n--; return n; }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    getMaxColumns() { return 40; } getMaxRows() { return 1000; } insertColumnsAfter() { } setFrozenRows() { }
    deleteRow(r) { this.data.splice(r - 1, 1); }
  }
  const book = { sheets: { Sheet1: new Sheet('Sheet1') },
    getSheetByName(n) { return this.sheets[n] || null; }, insertSheet(n) { return (this.sheets[n] = new Sheet(n)); },
    getSheets() { return Object.values(this.sheets); }, deleteSheet(s) { delete this.sheets[s.name]; }, setSpreadsheetTimeZone() { } };
  const cacheStore = {}, props = {};
  function fmt(date, tz, pattern) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date).map(x => [x.type, x.value]));
    const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
      .replace(/^H$/, String(+p.hour)).replace(/^u$/, String(wd));
  }
  const ctx = {
    Date: FDate, console: { log() { }, error: (...a) => console.error('  [gs error]', ...a) }, JSON, Math, Object, Array, String, Number, RegExp, Error, isNaN, parseInt, encodeURIComponent, Infinity,
    SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
    Utilities: {
      formatDate: fmt, getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()),
      base64EncodeWebSafe: (b) => Buffer.from(b.map(x => x & 255)).toString('base64url'),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() { }, releaseLock() { } }) },
    CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] ?? null, put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    MailApp: { sendEmail: (o) => { if (!/@/.test(o.to)) throw new Error('Invalid email'); sent.push(o); }, getRemainingDailyQuota: () => 1500 },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ inTimezone: () => ({ create() { } }) }), everyMinutes: () => ({ create() { } }) }) }), deleteTrigger() { } },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: (s) => ({ setTitle: () => s }) },
    Logger: { log() { } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(process.argv[2] || require('path').join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { ctx, book, sent, setNow: (iso) => { fakeNow = new Date(iso).getTime(); } };
}
module.exports = { makeEnv };
