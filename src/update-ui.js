// Update controls are driven exclusively by the native updater state.
(() => {
    if (window.top !== window || window.__thk_updateState) return;
    let state = { phase: 'idle', current_version: '__VERSION__' };
    let dialog = null;
    let banner = null;
    let restoreFocus = null;
    let dismissedVersion = '';
    const translations = {
        vi: { title:'Cập nhật THK-Chat', current:'Phiên bản hiện tại', latest:'Phiên bản mới', checking:'Đang kiểm tra GitHub Releases…', available:'Có bản cập nhật mới', downloading:'Đang tải và xác minh bản cập nhật…', ready:'Bản cập nhật đã sẵn sàng', installing:'Đang cập nhật và khởi động lại…', upToDate:'Bạn đang dùng phiên bản mới nhất.', error:'Chưa thể cập nhật', check:'Kiểm tra lại', download:'Tải bản cập nhật', install:'Cập nhật và khởi động lại', later:'Để sau', close:'Đóng', details:'Xem cập nhật', release:'Xem trên GitHub', notes:'Nội dung cập nhật', save:'Lưu nội dung đang soạn trước khi khởi động lại app.', keep:'Bạn có thể đóng hộp thoại và tiếp tục làm việc trong lúc tải.' },
        en: { title:'Update THK-Chat', current:'Current version', latest:'New version', checking:'Checking GitHub Releases…', available:'An update is available', downloading:'Downloading and verifying the update…', ready:'The update is ready', installing:'Updating and restarting…', upToDate:'You are using the latest version.', error:'Update unavailable', check:'Check again', download:'Download update', install:'Update and restart', later:'Later', close:'Close', details:'View update', release:'View on GitHub', notes:'Release notes', save:'Save any unfinished work before restarting the app.', keep:'You can close this dialog and keep working while the update downloads.' },
        ja: { title:'THK-Chatを更新', current:'現在のバージョン', latest:'新しいバージョン', checking:'GitHub Releasesを確認中…', available:'新しい更新があります', downloading:'更新をダウンロード・検証中…', ready:'更新の準備ができました', installing:'更新して再起動中…', upToDate:'最新バージョンを使用しています。', error:'更新できません', check:'再確認', download:'更新をダウンロード', install:'更新して再起動', later:'後で', close:'閉じる', details:'更新を表示', release:'GitHubで表示', notes:'更新内容', save:'再起動する前に作業内容を保存してください。', keep:'ダウンロード中はこの画面を閉じて作業を続けられます。' }
    };
    function language() {
        let setting; try { setting = JSON.parse(localStorage.getItem('thk-toolkit.language')); } catch {}
        const value = setting && setting !== 'auto' ? setting : window.CW?.application?.languageCode?.value || document.documentElement.lang || navigator.language;
        return String(value).startsWith('ja') ? 'ja' : String(value).startsWith('vi') ? 'vi' : 'en';
    }
    const t = key => translations[language()][key];
    function send(type) { window.ipc?.postMessage(JSON.stringify({ type })); }
    function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; }
    function button(text, cls, action) { const el = node('button', cls, text); el.type = 'button'; el.addEventListener('click', action); return el; }
    function close() {
        dialog?.remove(); dialog = null; document.removeEventListener('keydown', keyboard, true);
        if (restoreFocus?.isConnected) restoreFocus.focus();
    }
    function keyboard(event) {
        if (!dialog) return;
        if (event.ctrlKey || event.metaKey) event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
        if (event.key === 'Tab') {
            const items = [...dialog.querySelectorAll('button:not(:disabled),a[href]')];
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
    }
    function open() {
        if (!document.body) return;
        if (!dialog) { restoreFocus = document.activeElement; dialog = node('div', 'thk-update-overlay'); document.body.appendChild(dialog); document.addEventListener('keydown', keyboard, true); }
        render(); dialog.querySelector('.thk-update-close')?.focus();
    }
    function render() {
        if (!dialog) return;
        const focused = document.activeElement?.dataset.updateAction;
        dialog.replaceChildren();
        const box = node('section', 'thk-update-box'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'thk-update-heading');
        const header = node('header', 'thk-update-header'); const title = node('h2', '', t('title')); title.id = 'thk-update-heading'; header.appendChild(title);
        const closeButton = button('×', 'thk-update-close', close); closeButton.setAttribute('aria-label', t('close')); closeButton.dataset.updateAction = 'close'; header.appendChild(closeButton); box.appendChild(header);
        const body = node('div', 'thk-update-body');
        body.appendChild(node('div', 'thk-update-version', `${t('current')}: ${state.current_version}`));
        if (state.version) body.appendChild(node('div', 'thk-update-version', `${t('latest')}: ${state.version}`));
        const status = node('p', 'thk-update-status', t(({ idle:'checking', current:'upToDate' })[state.phase] || state.phase)); status.setAttribute('role', 'status'); body.appendChild(status);
        if (state.phase === 'error') body.appendChild(node('p', 'thk-update-error', state.message));
        if (state.phase === 'downloading') {
            const progress = node('progress', 'thk-update-progress'); progress.max = 100; progress.value = state.progress || 0; progress.setAttribute('aria-label', t('downloading')); body.appendChild(progress);
            body.appendChild(node('p', 'thk-update-hint', `${state.progress || 0}% · ${t('keep')}`));
        }
        if (state.notes && ['available','downloading','ready'].includes(state.phase)) {
            body.appendChild(node('h3', '', t('notes'))); body.appendChild(node('pre', 'thk-update-notes', state.notes));
        }
        if (state.phase === 'ready') body.appendChild(node('p', 'thk-update-hint', t('save')));
        if (state.release_url && /^https:\/\/github\.com\/mrbinh008\/chatwork-rust\/releases\/tag\/v?\d+\.\d+\.\d+$/.test(state.release_url)) {
            const link = node('a', 'thk-update-link', t('release')); link.href = state.release_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.appendChild(link);
        }
        box.appendChild(body);
        const footer = node('footer', 'thk-update-footer');
        footer.appendChild(button(t(['available','ready'].includes(state.phase) ? 'later' : 'close'), 'thk-update-secondary', close));
        const action = state.phase === 'available' ? ['download','DownloadUpdate'] : state.phase === 'ready' ? ['install','InstallUpdate'] : ['current','error'].includes(state.phase) ? ['check','CheckForUpdates'] : null;
        if (action) {
            const primary = button(t(action[0]), 'thk-update-primary', () => { primary.disabled = true; send(action[1]); }); primary.dataset.updateAction = action[0]; footer.appendChild(primary);
        }
        box.appendChild(footer); dialog.appendChild(box);
        if (focused) dialog.querySelector(`[data-update-action="${focused}"]`)?.focus();
    }
    function renderBanner() {
        banner?.remove(); banner = null;
        if (!document.body || !['available','ready'].includes(state.phase) || dismissedVersion === state.version) return;
        banner = node('aside', 'thk-update-banner'); banner.setAttribute('aria-label', t('title'));
        banner.appendChild(node('span', '', `${t(state.phase)} · v${state.version}`));
        banner.appendChild(button(t('details'), 'thk-update-primary', open));
        const dismiss = button('×', 'thk-update-close', () => { dismissedVersion = state.version; banner.remove(); banner = null; }); dismiss.setAttribute('aria-label', t('close')); banner.appendChild(dismiss); document.body.appendChild(banner);
    }
    window.__thk_updateState = next => {
        state = next;
        if (!document.body) return;
        if (next.open) open(); else render();
        renderBanner();
    };
    window.__thk_openUpdates = () => { open(); send('CheckForUpdates'); };
    const start = () => { renderBanner(); send('UpdateUiReady'); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
