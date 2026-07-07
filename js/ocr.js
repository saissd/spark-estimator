/* ============================================================
 * ocr.js — offline serial-number reader.
 *
 * Wraps Tesseract.js (vendored locally so it runs with no network).
 * Everything is lazy: the ~10 MB engine + language data is only
 * fetched the first time an agent actually scans a serial, so the
 * app's cold start stays fast. Once fetched it's cached by the
 * service worker and works offline thereafter.
 *
 * Public API:
 *   OCR.readSerial(blob, onProgress) -> Promise<{ serial, raw }>
 * ============================================================ */

const OCR = (() => {
  const TESS_SRC = 'vendor/tesseract/tesseract.min.js';
  let _scriptPromise = null;
  let _worker = null;
  let _workerPromise = null;

  function loadScript() {
    if (window.Tesseract) return Promise.resolve();
    if (_scriptPromise) return _scriptPromise;
    _scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESS_SRC;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load OCR engine'));
      document.head.appendChild(s);
    });
    return _scriptPromise;
  }

  async function getWorker(onProgress) {
    if (_worker) return _worker;
    if (_workerPromise) return _workerPromise;
    _workerPromise = (async () => {
      await loadScript();
      const worker = await window.Tesseract.createWorker('eng', 1, {
        workerPath: 'vendor/tesseract/worker.min.js',
        // Point at the exact full SIMD core we vendored (it includes LSTM),
        // so the worker doesn't try to auto-fetch a variant we don't ship.
        corePath: 'vendor/tesseract/tesseract-core-simd.wasm.js',
        langPath: 'vendor/tessdata',
        logger: m => { if (onProgress && m.status) onProgress(m); },
      });
      // Serial plates are short codes — bias the recognizer toward a
      // single line of capitals/digits.
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/. ',
        preserve_interword_spaces: '1',
      });
      _worker = worker;
      return worker;
    })();
    return _workerPromise;
  }

  // Pull the most serial-looking token out of the raw OCR text.
  // Heuristic: prefer longer tokens that mix letters and digits.
  function pickSerial(raw) {
    if (!raw) return '';
    const tokens = raw.toUpperCase().replace(/[^A-Z0-9\-/.\s]/g, ' ').split(/\s+/).filter(Boolean);
    let best = '', bestScore = -1;
    for (const t of tokens) {
      const clean = t.replace(/[^A-Z0-9-]/g, '');
      if (clean.length < 5) continue;
      const hasDigit = /\d/.test(clean);
      const hasAlpha = /[A-Z]/.test(clean);
      let score = clean.length;
      if (hasDigit) score += 4;
      if (hasDigit && hasAlpha) score += 4; // serials are usually mixed
      if (score > bestScore) { bestScore = score; best = clean; }
    }
    return best;
  }

  async function readSerial(blob, onProgress) {
    const worker = await getWorker(onProgress);
    const { data } = await worker.recognize(blob);
    const raw = (data && data.text ? data.text : '').trim();
    return { serial: pickSerial(raw), raw };
  }

  // Optional: free the worker (e.g. low-memory). Safe to call anytime.
  async function dispose() {
    try { if (_worker) await _worker.terminate(); } catch { /* worker already gone — best-effort cleanup */ }
    _worker = null; _workerPromise = null;
  }

  return { readSerial, dispose, isLoaded: () => !!window.Tesseract };
})();

window.OCR = OCR;
