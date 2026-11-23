(() => {
  const status = document.getElementById('offlineStatus');
  const retry = document.getElementById('offlineRetry');
  const shell = new URL('./trainer-v71-preview.html', location.href);
  const script = new URL('./trainer-v71-sw.js', location.href);
  const workers = navigator.serviceWorker;
  if (!workers || !window.isSecureContext) {
    status.textContent = 'Offline access requires HTTPS and a browser that supports service workers.';
    return;
  }

  function hasPreviewWorker() {
    return workers.controller && workers.controller.scriptURL === script.href;
  }

  function confirmBundle(worker) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const finish = ready => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), 30000);
      channel.port1.onmessage = event => finish(event.data === true);
      worker.postMessage('check-trainer-offline', [channel.port2]);
    });
  }

  async function prepare() {
    if (retry.disabled) return;
    retry.disabled = true;
    retry.hidden = true;
    status.textContent = 'Preparing workouts for offline use…';
    let onChange;
    let timeout;
    try {
      if (!hasPreviewWorker()) {
        const registration = await workers.register(script.href, { scope: shell.href, updateViaCache: 'none' });
        // The main app can already control this tab; its readiness does not cover 7.1.
        if (!hasPreviewWorker()) {
          await new Promise((resolve, reject) => {
            const installing = registration.installing;
            onChange = () => {
              if (hasPreviewWorker()) resolve();
              else if (installing?.state === 'redundant' && !registration.active) reject();
            };
            timeout = setTimeout(reject, 30000);
            workers.addEventListener('controllerchange', onChange);
            if (installing) installing.addEventListener('statechange', onChange);
            onChange();
          });
        }
      } else if (navigator.onLine) {
        workers.getRegistration(shell.href).then(reg => reg?.update()).catch(() => {});
      }
      if (!hasPreviewWorker() || !(await confirmBundle(workers.controller))) throw new Error();
      status.textContent = 'Ready offline · Workouts, timers and movement guides are saved on this device.';
    } catch {
      status.textContent = 'Offline access is not ready. Reconnect and try again.';
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (onChange) workers.removeEventListener('controllerchange', onChange);
      retry.disabled = false;
    }
  }

  retry.addEventListener('click', prepare);
  window.addEventListener('online', () => { if (!retry.hidden) prepare(); });
  prepare();
})();
