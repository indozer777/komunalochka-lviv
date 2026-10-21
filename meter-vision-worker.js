/* Same-origin worker; messages only, no fetch/upload or persistent storage. */
importScripts('/meter-vision-core.js');
self.onmessage = ({ data: { id, action, image, options } }) => {
  try {
    const result = action === 'analyze' ? self.KomunalMeterVision.analyze(image, options) : self.KomunalMeterVision.prepare(image, options);
    if (action === 'prepare') result.segments = self.KomunalMeterVision.sevenSegment(result);
    const buffers = action === 'prepare' ? [result.normalized.buffer, result.binary.buffer, result.adaptive.buffer] : [];
    self.postMessage({ id, result }, buffers);
  } catch (_) { self.postMessage({ id, error: 'vision-failed' }); }
};
