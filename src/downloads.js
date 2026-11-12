(function() {
    'use strict';
    let downloadIntentUntil = 0;
    function knownDownload(href) {
        try {
            const url = new URL(href, location.href);
            if (url.protocol === 'blob:' || url.protocol === 'data:') return true;
            if (!['http:', 'https:'].includes(url.protocol)) return false;
            const host = url.hostname.toLowerCase();
            return ['chatwork.com','kcw.kddi.ne.jp','kcw.kddi.com'].some(domain => host === domain || host.endsWith('.' + domain))
                && url.pathname.toLowerCase().split('/').some(part => ['download','download_file.php','download.php'].includes(part));
        } catch(error) { return false; }
    }
    function downloadFrame() {
        const frame = document.createElement('iframe');
        frame.hidden = true; frame.style.display = 'none'; frame.setAttribute('aria-hidden', 'true');
        frame.className = 'thk-download-frame';
        (document.body || document.documentElement).appendChild(frame);
        return frame;
    }
    window.__thk_startDownload = function(href, filename = '') {
        let url;
        try { url = new URL(href, location.href); } catch(error) { return null; }
        if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) return null;
        if (url.protocol === 'blob:' || url.protocol === 'data:') {
            const link = document.createElement('a'); link.href = url.href; link.download = filename; link.target = '_self';
            link.setAttribute('data-thk-download-internal', 'true');
            (document.body || document.documentElement).appendChild(link); link.click(); link.remove();
            return null;
        }
        // Attachment responses start a native download without replacing the chat page.
        const frame = downloadFrame(); frame.src = url.href;
        return frame.contentWindow;
    };
    document.addEventListener('click', event => {
        const control = event.target?.closest?.('a, button, [role="button"]');
        if (!control || control.hasAttribute('data-thk-download-internal')) return;
        const labels = [control.getAttribute('aria-label'), control.title, control.textContent].filter(Boolean).map(label => label.trim());
        const explicit = control.hasAttribute('download') || /download/i.test(control.getAttribute('data-testid') || '')
            || labels.some(label => /^(download|tải xuống|tải về|ダウンロード)(\s+(file|ファイル))?(\s*\([^)]*\))?$/i.test(label));
        downloadIntentUntil = explicit ? Date.now() + 15000 : 0;
        if (control.tagName === 'A' && (control.hasAttribute('download') || knownDownload(control.href) || explicit)) {
            if (!['http:', 'https:', 'blob:', 'data:'].includes(new URL(control.href, location.href).protocol)) return;
            event.preventDefault(); event.stopImmediatePropagation(); downloadIntentUntil = 0;
            window.__thk_startDownload(control.href, control.getAttribute('download') || '');
        }
    }, true);
    const originalOpen = window.open;
    window.open = function(href, ...args) {
        const target = href == null ? '' : String(href);
        const intendedDownload = Date.now() < downloadIntentUntil;
        if (intendedDownload && (!target || target === 'about:blank')) {
            downloadIntentUntil = 0;
            // Some file actions reserve a blank popup before fetching an authenticated URL.
            // A same-session frame provides that WindowProxy without spawning an external browser.
            return downloadFrame().contentWindow;
        }
        if (knownDownload(target) || (intendedDownload && /^https?:/i.test(target))) {
            downloadIntentUntil = 0; return window.__thk_startDownload(target);
        }
        return originalOpen.apply(this, [href, ...args]);
    };
})();
