import { World } from '/shared/world.js';

export function generateClientWorld(settings, progress, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
    const finish = (error, data) => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(World.fromData(data));
    };
    const abort = () => finish(new Error('World loading cancelled.'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error));
      else if (data.world) finish(null, data.world);
      else progress(data);
    };
    worker.onerror = (event) => finish(new Error(event.message || 'World generation worker failed.'));
    worker.postMessage({ seed: settings.seed, teamCount: settings.teamCount, worldSize: settings.worldSize });
  });
}
