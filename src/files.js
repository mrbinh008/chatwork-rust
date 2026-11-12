(() => {
    'use strict';
    const labels = {
        vi: { title:'Quản lý file', all:'Tất cả', image:'Ảnh', document:'Tài liệu', video:'Video', other:'Khác', search:'Tìm tên file hoặc người tải lên…', refresh:'Tải lại', loading:'Đang tải danh sách file…', empty:'Không tìm thấy file phù hợp.', download:'Tải xuống', returned:'file do Chatwork trả về', fallback:'Đang hiển thị file có trong phần chat đã tải.', unavailable:'Chưa đọc được danh sách file từ Chatwork. Hãy mở lại hoặc tải lại danh sách.', changed:'Nhóm đã thay đổi. Hãy mở lại Quản lý file.', unknown:'Không rõ người tải lên', count:'file' },
        en: { title:'Files', all:'All', image:'Images', document:'Documents', video:'Videos', other:'Other', search:'Search files or uploaders…', refresh:'Refresh', loading:'Loading files…', empty:'No matching files.', download:'Download', returned:'files returned by Chatwork', fallback:'Showing attachments from the loaded chat.', unavailable:'Could not read the Chatwork file list. Reopen or refresh the list.', changed:'The group changed. Reopen Files.', unknown:'Unknown uploader', count:'files' },
        ja: { title:'ファイル管理', all:'すべて', image:'画像', document:'文書', video:'動画', other:'その他', search:'ファイル名・アップロード者で検索…', refresh:'再読み込み', loading:'ファイルを読み込み中…', empty:'該当するファイルはありません。', download:'ダウンロード', returned:'件（Chatworkから取得）', fallback:'読み込み済みチャットの添付ファイルを表示しています。', unavailable:'ファイル一覧を取得できませんでした。再度開くか再読み込みしてください。', changed:'グループが変更されました。開き直してください。', unknown:'アップロード者不明', count:'件' }
    };
    const t = key => labels[window.__thkToolkit?.getLanguage?.() || 'en'][key];
    const unwrap = value => {
        for (let depth=0; value && typeof value === 'object' && 'value' in value && depth<4; depth++) value = value.value;
        return value;
    };
    function category(name, mime = '') {
        const extension = String(name).split('.').pop().toLowerCase();
        if (/^image\//i.test(mime)) return 'image';
        if (/^video\//i.test(mime)) return 'video';
        if (/^(text\/|application\/(pdf|msword|vnd\.(openxmlformats|ms-|oasis)))/i.test(mime)) return 'document';
        if (/^(png|jpe?g|gif|webp|avif|heic|heif|bmp|tiff?|svg|ico)$/.test(extension)) return 'image';
        if (/^(mp4|m4v|mov|avi|mkv|webm|wmv|flv|mpeg|mpg|3gp|ts)$/.test(extension)) return 'video';
        if (/^(pdf|docx?|xlsx?|pptx?|txt|csv|md|rtf|odt|ods|odp|pages|numbers|key)$/.test(extension)) return 'document';
        return 'other';
    }
    function trustedUrl(value) {
        if (typeof value !== 'string' || !value) return '';
        try {
            const url = new URL(value, location.origin);
            if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return '';
            if (!['chatwork.com','kcw.kddi.ne.jp','kcw.kddi.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
            return url.href;
        } catch { return ''; }
    }
    function normalizeFiles(data) {
        const result = data?.result || data;
        const list = result?.file_dat ?? result?.file_list ?? result?.files;
        if (!list || typeof list !== 'object') return null;
        const entries = Array.isArray(list) ? list.map(file => ['',file]) : Object.entries(list);
        const users = window.CW?.application?.domainServiceContext?.userService?.userRepository?.entities || {};
        const seen = new Set();
        return entries.map(([key,raw]) => {
            if (!raw || typeof raw !== 'object') return null;
            const id = String(unwrap(raw.file_id ?? raw.fid ?? raw.id ?? raw.identity) ?? key);
            const name = unwrap(raw.filename ?? raw.file_name ?? raw.name ?? raw.fn);
            if (!/^\d+$/.test(id) || typeof name !== 'string' || !name || seen.has(id)) return null;
            seen.add(id);
            const aid = String(unwrap(raw.account_id ?? raw.aid ?? raw.uploaded_by ?? '') || '');
            const mime = String(unwrap(raw.mime_type ?? raw.content_type ?? raw.mime ?? '') || '');
            const size = Number(unwrap(raw.filesize ?? raw.file_size ?? raw.size ?? raw.fs)) || 0;
            const timestamp = Number(unwrap(raw.upload_time ?? raw.uploaded_at ?? raw.send_time ?? raw.tm ?? 0));
            return { id, name, mime, category:category(name,mime), size:Math.max(0,size), uploader:users[aid]?.name?.value || String(unwrap(raw.uploader_name ?? '') || ''), timestamp,
                url:trustedUrl(unwrap(raw.download_url ?? raw.downloadUrl ?? raw.dl_url ?? raw.dlink ?? raw.url)), previewUrl:trustedUrl(unwrap(raw.preview_url ?? raw.previewUrl ?? raw.view_url)), thumbnail:trustedUrl(unwrap(raw.thumbnail_url ?? raw.thumbnail ?? '')) };
        }).filter(Boolean);
    }
    function loadedAttachments() {
        const seen = new Set();
        return [...document.querySelectorAll('#_timeLine a[href*="download_file.php"], #CurrentSelectedRoom a[href*="download_file.php"]')].map(link => {
            const url = trustedUrl(link.href); if (!url) return null;
            const id = new URL(url).searchParams.get('file_id');
            const name = link.getAttribute('download') || link.textContent.trim();
            if (!/^\d+$/.test(id || '') || !name || seen.has(id)) return null;
            seen.add(id); return { id, name, category:category(name), size:0, uploader:'', timestamp:0, url, thumbnail:'' };
        }).filter(Boolean);
    }
    function filterFiles(files, kind, query) {
        const text = String(query).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        return files.filter(file => (kind === 'all' || file.category === kind) && `${file.name} ${file.uploader}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(text));
    }
    function sizeLabel(bytes) { if (!bytes) return ''; const unit = bytes >= 1048576 ? 'MB' : bytes >= 1024 ? 'KB' : 'B'; return `${Math.round(bytes / (unit==='MB'?1048576:unit==='KB'?1024:1) * 10)/10} ${unit}`; }
    function downloadUrl(file) { return trustedUrl(file.url) || new URL(`/gateway/download_file.php?file_id=${encodeURIComponent(file.id)}&bin=1`,location.origin).href; }
    function previewUrls(file) {
        const gateway=/^\d+$/.test(file.id)?new URL(`/gateway/download_file.php?file_id=${file.id}&bin=1`,location.origin).href:'';
        return [...new Set([trustedUrl(file.url),gateway,trustedUrl(file.previewUrl)].filter(Boolean))];
    }
    async function fetchFiles(roomId, signal) {
        const app = window.CW?.application;
        const token = app?.domainAPIServiceContext?.taskAPIService?.apiClient?.accessToken;
        const myId = app?.myId?.userId?.value;
        if (!token || !myId) throw new Error(t('unavailable'));
        const url = new URL('/gateway/load_chat.php', location.origin); url.searchParams.set('myid', String(myId));
        const body = new FormData();
        body.append('pdata', JSON.stringify({ _t:token, _v:'1.80a', _av:'5', ln:app.languageCode?.value || 'en', room_id:roomId, last_chat_id:0, limit_num:1, file:1 }));
        const response = await fetch(url.href, { method:'POST', credentials:'include', body, signal });
        if (!response.ok) throw new Error(t('unavailable'));
        const files = normalizeFiles(await response.json());
        if (files === null) throw new Error(t('unavailable'));
        return files;
    }
    function open() {
        const toolkit = window.__thkToolkit;
        const room = toolkit?.getRoom(); if (!room?.id) return;
        const view = toolkit.panel(t('title'));
        view.backdrop.classList.add('thk-files-panel');
        const make = (tag,cls,text) => { const el=document.createElement(tag); el.className=cls || ''; if (text) el.textContent=text; return el; };
        const controls = make('div','thk-file-controls');
        const search = make('input','thk-input-field'); search.type='search'; search.placeholder=t('search'); search.setAttribute('aria-label',t('search')); controls.appendChild(search);
        const refresh = make('button','thk-btn-secondary',t('refresh')); refresh.type='button'; controls.appendChild(refresh); view.body.appendChild(controls);
        const filters = make('div','thk-file-filters'); filters.setAttribute('role','group'); filters.setAttribute('aria-label',t('title')); view.body.appendChild(filters);
        const summary = make('p','thk-leave-hint'); summary.setAttribute('role','status'); view.body.appendChild(summary);
        const list = make('div','thk-file-list'); view.body.appendChild(list);
        let files=[], kind='all', closed=false, request=null, fallback=false, previewDispose=null;
        view.cleanup.push(() => { closed=true; request?.abort(); previewDispose?.(); });
        function preview(file,previousFocus){
            if (toolkit.getRoom().id!==room.id) { summary.textContent=t('changed');return; }
            const scroll=view.body.scrollTop;[controls,filters,summary,list].forEach(el=>el.hidden=true);
            previewDispose=window.__thkFilePreview.open(file,{body:view.body,isCurrent:()=>!closed&&toolkit.getRoom().id===room.id,onBack:()=>{
                previewDispose=null;[controls,filters,summary,list].forEach(el=>el.hidden=false);view.body.scrollTop=scroll;previousFocus?.focus();
            }});view.body.scrollTop=0;
        }
        function render() {
            filters.replaceChildren();
            ['all','image','document','video','other'].forEach(value => {
                const count = value === 'all' ? files.length : files.filter(file=>file.category===value).length;
                const choice = make('button','thk-chip-btn' + (kind===value?' active':''), `${t(value)} (${count})`); choice.type='button'; choice.setAttribute('aria-pressed', String(kind===value));
                choice.addEventListener('click',()=>{kind=value;render();}); filters.appendChild(choice);
            });
            const visible = filterFiles(files,kind,search.value);
            summary.textContent = `${visible.length} / ${files.length} ${t('returned')}.` + (fallback ? ' ' + t('fallback') : '');
            list.replaceChildren();
            if (!visible.length) { list.appendChild(make('p','thk-file-empty',t('empty'))); return; }
            visible.forEach(file => {
                const row=make('article','thk-file-row');
                const icon=make('span','thk-file-icon',({image:'IMG',document:'DOC',video:'VID',other:'FILE'})[file.category]); icon.setAttribute('aria-hidden','true'); row.appendChild(icon);
                if (file.thumbnail && file.category==='image') {
                    const image=make('img','thk-file-thumbnail'); image.src=file.thumbnail; image.alt=''; image.loading='lazy'; image.addEventListener('error',()=>image.remove()); icon.replaceChildren(image);
                }
                const details=make('div','thk-file-details');const name=make('button','thk-file-name thk-file-open',file.name);name.type='button';name.addEventListener('click',()=>preview(file,name));details.appendChild(name);
                const date=file.timestamp>0 ? new Date(file.timestamp>1e12?file.timestamp:file.timestamp*1000).toLocaleDateString() : '';
                details.appendChild(make('span','thk-file-meta',[t(file.category),sizeLabel(file.size),file.uploader || t('unknown'),date].filter(Boolean).join(' · ')));
                if (file.category === 'image') {
                    const thumbUrl = file.thumbnail || downloadUrl(file);
                    const thumbWrap = make('div', 'thk-file-inline-thumb-wrap');
                    const img = make('img', 'thk-file-inline-thumb');
                    img.src = thumbUrl; img.alt = file.name; img.loading = 'lazy';
                    img.title = file.name;
                    img.addEventListener('click', () => preview(file, img));
                    img.addEventListener('error', () => thumbWrap.remove());
                    thumbWrap.appendChild(img);
                    details.appendChild(thumbWrap);
                }
                row.appendChild(details);
                const download=make('button','thk-btn-secondary thk-file-download',t('download')); download.type='button'; download.setAttribute('aria-label',`${t('download')}: ${file.name}`);
                download.addEventListener('click',()=>{
                    if (toolkit.getRoom().id !== room.id) { summary.textContent=t('changed'); return; }
                    window.__thk_startDownload?.(downloadUrl(file),file.name);
                });
                const actions=make('div','thk-file-actions'),previewButton=make('button','thk-btn-secondary thk-file-preview',({vi:'Xem trước',en:'Preview',ja:'プレビュー'})[toolkit.getLanguage()]);previewButton.type='button';previewButton.addEventListener('click',()=>preview(file,previewButton));
                actions.append(previewButton,download);row.appendChild(actions);list.appendChild(row);
            });
        }
        async function load() {
            request?.abort(); const controller=new AbortController(); request=controller;
            const timer=setTimeout(()=>controller.abort(),30000);
            refresh.disabled=true; summary.textContent=t('loading');
            try {
                const loaded=await fetchFiles(room.id,controller.signal);
                if (closed || request!==controller) return;
                if (toolkit.getRoom().id !== room.id) throw new Error(t('changed'));
                files=loaded; fallback=false; render();
            } catch(error) {
                if (closed || request!==controller) return;
                if (toolkit.getRoom().id !== room.id) { summary.textContent=t('changed'); return; }
                const loaded=loadedAttachments();
                if (loaded.length) { files=loaded; fallback=true; render(); }
                else summary.textContent=t('unavailable');
            } finally { clearTimeout(timer); if (request===controller) refresh.disabled=false; }
        }
        search.addEventListener('input',render); refresh.addEventListener('click',load); load();
    }
    window.__thkFiles = { open, category, normalizeFiles, filterFiles, downloadUrl, previewUrls };
})();
