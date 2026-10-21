/* Local meter vision: geometry, illumination and seven-segment patterns.
 * No network, training data, DOM, or photo persistence. Also used by node tests. */
(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function pixels(image, ignoreRed = false) {
    const { width: w, height: h, data } = image;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 2400000 || data.length !== w * h * 4) throw new Error('image-size');
    const gray = new Uint8Array(w * h), red = new Uint8Array(w * h), histogram = new Uint32Array(256);
    let redCount = 0;
    for (let i = 0; i < gray.length; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      red[i] = +(r > 90 && r > g * 1.4 && r > b * 1.3 && r - Math.min(g, b) > 45);
      redCount += red[i];
      gray[i] = ignoreRed && red[i] ? 255 : Math.round(r * .299 + g * .587 + b * .114);
      histogram[gray[i]]++;
    }
    return { gray, red, redCount, histogram, w, h };
  }
  function otsu(gray) {
    const hist = new Uint32Array(256); let total = 0;
    for (const v of gray) { hist[v]++; total += v; }
    let count = 0, sum = 0, best = -1, threshold = 127;
    for (let v = 0; v < 255; v++) {
      count += hist[v]; sum += v * hist[v];
      if (!count || count === gray.length) continue;
      const difference = sum / count - (total - sum) / (gray.length - count);
      const variance = count * (gray.length - count) * difference * difference;
      if (variance > best) { best = variance; threshold = v; }
    }
    return threshold;
  }
  function mask(gray, w, h, light = false, local = false) {
    const out = new Uint8Array(w * h), threshold = otsu(gray);
    let integral, stride = w + 1;
    if (local) {
      integral = new Float64Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let x = 0; x < w; x++) { sum += gray[y * w + x]; integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum; }
      }
    }
    const radius = clamp(Math.round(Math.min(w, h) / 16), 8, 30);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let t = threshold;
      if (local) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1), y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
        t = (integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
      }
      out[y * w + x] = +(light ? gray[y * w + x] > t + (local ? 10 : 0) : gray[y * w + x] <= t - (local ? 10 : 0));
    }
    return out;
  }
  function close(input, w, h) {
    // Join small gaps between segments without merging adjacent digit cells.
    const temp = new Uint8Array(input.length), out = new Uint8Array(input.length);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      let ink = 0;
      for (let dy = -2; dy <= 2 && !ink; dy++) for (let dx = -2; dx <= 2; dx++) if (input[(y + dy) * w + x + dx]) { ink = 1; break; }
      temp[y * w + x] = ink;
    }
    for (let y = 4; y < h - 4; y++) for (let x = 4; x < w - 4; x++) {
      let ink = 1;
      for (let dy = -2; dy <= 2 && ink; dy++) for (let dx = -2; dx <= 2; dx++) if (!temp[(y + dy) * w + x + dx]) { ink = 0; break; }
      out[y * w + x] = ink;
    }
    return out;
  }
  function components(input, w, h) {
    const seen = new Uint8Array(input.length), queue = new Int32Array(input.length), result = [];
    for (let i = 0; i < input.length; i++) {
      if (!input[i] || seen[i]) continue;
      let head = 0, tail = 1, left = i % w, right = left, top = Math.floor(i / w), bottom = top;
      queue[0] = i; seen[i] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = Math.floor(p / w);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        let next = p - 1;
        if (x && input[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
        next = p + 1;
        if (x < w - 1 && input[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
        next = p - w;
        if (y && input[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
        next = p + w;
        if (y < h - 1 && input[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
      const bw = right - left + 1, bh = bottom - top + 1;
      if (bh >= 9 && bh < h * .85 && bw / bh >= .07 && bw / bh <= 1.15 && tail / (bw * bh) > .08 && tail > 12) result.push({ x: left, y: top, w: bw, h: bh });
      if (result.length > 1800) return []; // Texture/noise is not a display.
    }
    return result;
  }
  function overlap(a, b) {
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return area / Math.min(a.w * a.h, b.w * b.h);
  }
  function rows(boxes, w, h) {
    const found = [], sorted = boxes.slice().sort((a, b) => a.x - b.x);
    for (const seed of sorted) {
      const group = [seed]; let last = seed;
      for (const box of sorted) {
        if (box.x <= last.x || box.x - last.x - last.w > seed.h * 1.25 || box.x < last.x + last.w - seed.h * .08) continue;
        const ratio = box.h / seed.h, dx = box.x + box.w / 2 - last.x - last.w / 2, dy = box.y + box.h / 2 - last.y - last.h / 2;
        if (ratio < .65 || ratio > 1.5 || Math.abs(dy) > Math.max(seed.h * .28, dx * .24)) continue;
        group.push(box); last = box;
      }
      if (group.length < 3 || group.length > 9) continue;
      const left = seed.x, right = Math.max(...group.map(b => b.x + b.w)), top = Math.min(...group.map(b => b.y)), bottom = Math.max(...group.map(b => b.y + b.h));
      const mh = group.map(b => b.h).sort((a, b) => a - b)[Math.floor(group.length / 2)];
      if ((right - left) / mh < 1.2 || (right - left) / mh > 12) continue;
      const mx = group.reduce((s, b) => s + b.x + b.w / 2, 0) / group.length, my = group.reduce((s, b) => s + b.y + b.h / 2, 0) / group.length;
      let covariance = 0, variance = 0;
      for (const b of group) { const dx = b.x + b.w / 2 - mx; covariance += dx * (b.y + b.h / 2 - my); variance += dx * dx; }
      const angle = Math.atan2(covariance, variance) * 180 / Math.PI;
      if (Math.abs(angle) > 13) continue;
      const pad = Math.max(5, mh * .18), x = Math.max(0, Math.floor(left - pad)), y = Math.max(0, Math.floor(top - pad));
      found.push({ x, y, w: Math.min(w - x, Math.ceil(right + pad - x)), h: Math.min(h - y, Math.ceil(bottom + pad - y)), angle, score: mh * Math.sqrt(group.length), digits: group.length });
    }
    return found;
  }
  function analyze(image, options = {}) {
    const { gray, red, redCount, w, h } = pixels(image, options.ignoreRed), found = [];
    for (const light of [false, true]) for (const local of [false, true]) {
      const binary = mask(gray, w, h, light, local);
      if (options.ignoreRed) for (let i = 0; i < binary.length; i++) if (red[i]) binary[i] = 0;
      found.push(...rows(components(close(binary, w, h), w, h), w, h));
    }
    const regions = [];
    for (const r of found.sort((a, b) => b.score - a.score)) if (!regions.some(old => overlap(old, r) > .65)) regions.push(r);
    return { regions: regions.slice(0, 3), redPixels: redCount };
  }
  function prepare(image, options = {}) {
    const { gray, red, redCount, histogram, w, h } = pixels(image, options.ignoreRed);
    const percentile = fraction => { let sum = 0; for (let i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= gray.length * fraction) return i; } return 255; };
    const lo = percentile(.02), hi = percentile(.98), normalized = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) normalized[i] = hi - lo < 12 ? gray[i] : clamp(Math.round((gray[i] - lo) * 255 / (hi - lo)), 0, 255);
    // Infer polarity from the surrounding margin, not the count of lit segments.
    let border = 0, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < w * .06 || x >= w * .94 || y < h * .08 || y >= h * .92) { border += normalized[y * w + x]; count++; }
    const light = border / count < 127;
    let binary = mask(normalized, w, h, light, false), adaptive = mask(normalized, w, h, light, true);
    if (options.ignoreRed) for (let i = 0; i < gray.length; i++) if (red[i]) { binary[i] = adaptive[i] = 0; normalized[i] = light ? 0 : 255; }
    if (light) for (let i = 0; i < normalized.length; i++) normalized[i] = 255 - normalized[i];
    return { width: w, height: h, normalized, binary, adaptive, redPixels: redCount };
  }
  const PATTERNS = ['1111110','0110000','1101101','1111001','0110011','1011011','1011111','1110000','1111111','1111011'];
  const SEGMENTS = [[.23,.025,.77,.085],[.87,.18,.98,.38],[.87,.62,.98,.82],[.23,.9,.77,.97],[.02,.62,.13,.82],[.02,.18,.13,.38],[.23,.47,.77,.53]];
  function sevenSegment(prepared) {
    const { binary, width: w, height: h } = prepared, cols = new Uint32Array(w);
    let top = h, bottom = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (binary[y * w + x]) { cols[x]++; top = Math.min(top, y); bottom = Math.max(bottom, y); }
    const dh = bottom - top + 1;
    if (dh < 18 || dh > h * .98) return null;
    const spans = []; let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x] >= Math.max(2, dh * .07)) { if (start < 0) start = x; }
      else if (start >= 0) { spans.push([start, x]); start = -1; }
    }
    if (spans.length < 3 || spans.length > 8) return null;
    const widths = spans.map(([a, b]) => b - a), cellWidth = Math.max(...widths);
    if (cellWidth / dh < .32 || cellWidth / dh > .78) return null;
    let value = '', weakest = 1;
    for (const [left, right] of spans) {
      const sw = right - left, dw = sw < cellWidth * .4 ? cellWidth : sw, x0 = sw < cellWidth * .4 ? right - cellWidth : left;
      if (Math.abs(dw - cellWidth) > cellWidth * .25) return null;
      const activation = SEGMENTS.map(([a, b, c, d]) => {
        let ink = 0, count = 0;
        for (let y = Math.ceil(top + b * dh); y < top + d * dh; y++) for (let x = Math.ceil(x0 + a * dw); x < x0 + c * dw; x++) { count++; if (x >= 0 && x < w) ink += binary[y * w + x] || 0; }
        return ink / Math.max(1, count);
      });
      // Reject partial/rolling digits and uncertain segments instead of inventing one.
      if (activation.some(v => v > .18 && v < .6)) return null;
      const bits = activation.map(v => v >= .6 ? '1' : '0').join(''), digit = PATTERNS.indexOf(bits);
      if (digit < 0) return null;
      weakest = Math.min(weakest, ...activation.map(v => v >= .6 ? v : 1 - v)); value += digit;
    }
    return { value, confidence: Math.round(weakest * 100), engine: 'segments' };
  }
  function decide(evidence, { manual = false, regionCount = 1 } = {}) {
    const groups = new Map();
    for (const item of evidence) {
      if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(item.value) || !Number.isFinite(item.confidence) || item.confidence < 35) continue;
      const key = String(Number(item.value)); let group = groups.get(key);
      if (!group) { group = { value: item.value, confidence: 0, evidence: [] }; groups.set(key, group); }
      group.confidence = Math.max(group.confidence, item.confidence); group.evidence.push(item);
    }
    const choices = [...groups.values()].sort((a, b) => b.evidence.length - a.evidence.length || b.confidence - a.confidence).slice(0, 8);
    let automatic = false;
    if (choices.length === 1 && regionCount === 1) {
      const matches = choices[0].evidence;
      const segments = matches.find(e => e.engine === 'segments' && e.confidence >= 92);
      const ocr = matches.filter(e => e.engine !== 'segments' && e.confidence >= (manual ? 90 : 80));
      automatic = Boolean(segments && ocr.length || manual && new Set(ocr.map(e => e.engine)).size >= 2);
    }
    return { choices, automatic };
  }
  const api = Object.freeze({ analyze, prepare, sevenSegment, decide });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KomunalMeterVision = api;
})(typeof self === 'undefined' ? globalThis : self);
