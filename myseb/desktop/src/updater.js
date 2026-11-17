'use strict';
/** Never install, restart or display an update prompt during a live or paused exam. */
function createUpdater({ updater, active, notify, beforeInstall }) {
  let state = { status: 'idle' };
  const send = (next) => { state = next; if (!active()) notify(state); };
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  updater.on('checking-for-update', () => send({ status: 'checking' }));
  updater.on('update-available', (info) => send({ status: 'available', version: info.version }));
  updater.on('update-not-available', () => send({ status: 'current' }));
  updater.on('download-progress', (p) => send({ status: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => send({ status: 'downloaded', version: info.version }));
  updater.on('error', () => send({ status: 'error', message: 'Could not get the update. Check your connection and try again.' }));
  let checking = false;
  return {
    state: () => active() ? { status: 'idle' } : state,
    check: async () => {
      if (active() || checking || ['available', 'downloading', 'downloaded'].includes(state.status)) return state;
      checking = true;
      try { await updater.checkForUpdates(); } catch { send({ status: 'error', message: 'Update check failed. Please try again later.' }); } finally { checking = false; }
      return state;
    },
    download: async () => {
      if (active() || state.status !== 'available') return state;
      send({ status: 'downloading', percent: 0 });
      try { await updater.downloadUpdate(); } catch { send({ status: 'error', message: 'Download failed. Check your connection and try again.' }); }
      return state;
    },
    install: () => {
      if (active() || state.status !== 'downloaded') return false;
      beforeInstall(); updater.quitAndInstall(false, true); return true;
    },
  };
}
module.exports = { createUpdater };
