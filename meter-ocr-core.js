/* Meter photos: accept complete numeric rows, never repair guessed characters. */
(function (root) {
  'use strict';
  function numericRow(text) {
    const row = String(text || '').trim().replace(/^(?:T[12]|1\.8\.[012])\s*[:=]?\s+/i, '')
      .replace(/\s*(?:kWh|kW\s*h|m[³3]|м[³3]|кВт[·.]?год)\s*$/i, '').trim();
    if (!/^\d(?:[\d \t]*\d)?(?:\s*[.,]\s*\d{1,4})?$/.test(row)) return null;
    const value = row.replace(/[ \t]/g, '').replace(',', '.');
    if (value.split('.')[0].length > 8 || !Number.isFinite(Number(value)) || Number(value) >= 100000000) return null;
    return value;
  }
  function candidates(data) {
    const rows = [];
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs || [])
      for (const line of paragraph.lines || []) rows.push(line);
    if (!rows.length) rows.push(...String(data.text || '').split(/\r?\n/).map(text => ({ text, confidence: data.confidence })));
    const found = new Map();
    for (const row of rows) {
      const value = numericRow(row.text), confidence = Number(row.confidence) || 0;
      if (value === null || confidence < 35) continue;
      const key = String(Number(value)), old = found.get(key);
      if (!old || old.confidence < confidence) found.set(key, { value, confidence });
    }
    return [...found.values()].slice(0, 12);
  }
  const api = Object.freeze({ numericRow, candidates });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KomunalMeterOCR = api;
})(typeof window === 'undefined' ? globalThis : window);
