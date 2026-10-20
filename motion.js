/* Progressive enhancement: content stays visible when animation is unavailable. */
(() => {
  'use strict';
  const root = document.documentElement;
  const running = new Set(), byElement = new WeakMap();
  let observer, frame, savedTimer, savedReset, totalTimer;
  const mode = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'off' : root.dataset.motion || 'off';

  function play(element, frames, options) {
    if (!element?.isConnected || mode() === 'off' || typeof element.animate !== 'function') return;
    byElement.get(element)?.cancel();
    const animation = element.animate(frames, { easing: 'cubic-bezier(.22,1,.36,1)', ...options });
    running.add(animation); byElement.set(element, animation);
    animation.finished.catch(() => {}).finally(() => {
      running.delete(animation);
      if (byElement.get(element) === animation) byElement.delete(element);
    });
  }
  function stop() {
    cancelAnimationFrame(frame); observer?.disconnect();
    running.forEach(animation => animation.cancel()); running.clear();
    clearTimeout(savedTimer); clearTimeout(savedReset); clearTimeout(totalTimer);
    document.querySelector('#save-indicator')?.removeAttribute('data-saved');
  }
  function enterView(view) {
    stop();
    if (!view || view.hidden || mode() === 'off') return;
    frame = requestAnimationFrame(() => {
      if (mode() === 'quiet') {
        play(view, [{ opacity: .55 }, { opacity: 1 }], { duration: 140 }); return;
      }
      const targets = [...view.querySelectorAll('.page-heading,.welcome-card,.comfortable-guide,.profile-strip,.service-card,.summary-column>*,.panel')]
        .filter(element => element.getClientRects().length);
      const reveal = (element, delay = 0) => play(element,
        [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 420, delay, fill: 'backwards' });
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries => {
          let delay = 0;
          for (const entry of entries) if (entry.isIntersecting) {
            reveal(entry.target, delay); delay = Math.min(delay + 35, 140);
            observer.unobserve(entry.target);
          }
        }, { threshold: .08 });
      }
      let delay = 0;
      for (const element of targets) {
        const bounds = element.getBoundingClientRect();
        if (bounds.top < innerHeight && bounds.bottom > 0) {
          reveal(element, delay); delay = Math.min(delay + 35, 140);
        } else observer?.observe(element);
      }
    });
  }
  window.addEventListener('komunal-view-change', event => enterView(document.getElementById(`view-${event.detail.view}`)));
  window.addEventListener('komunal-motion-change', stop);
  window.addEventListener('pagehide', stop);
  window.addEventListener('komunal-saved', event => {
    clearTimeout(savedTimer);
    const indicator = document.querySelector('#save-indicator');
    if (!event.detail.ok || mode() === 'off') { indicator?.removeAttribute('data-saved'); return; }
    // Wait for a pause in typing, rather than drawing attention on every keystroke.
    savedTimer = setTimeout(() => {
      if (mode() === 'off') return;
      indicator?.setAttribute('data-saved', 'true');
      if (mode() === 'full') play(indicator?.querySelector('svg'),
        [{ transform: 'scale(.8)' }, { transform: 'scale(1.12)', offset: .6 }, { transform: 'scale(1)' }], { duration: 320 });
      clearTimeout(savedReset);
      savedReset = setTimeout(() => indicator?.removeAttribute('data-saved'), 1600);
    }, 380);
  });
  window.addEventListener('komunal-total-change', () => {
    clearTimeout(totalTimer);
    if (mode() !== 'full') return;
    totalTimer = setTimeout(() => play(document.getElementById('total-value'),
      [{ opacity: .55 }, { opacity: 1 }], { duration: 240 }), 180);
  });
})();
