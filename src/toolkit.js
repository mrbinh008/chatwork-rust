(function() {
    'use strict';
    const translations = {
        vi: { emoji:'Emoji gần đây', settings:'Cài đặt THK-Chat', pr:'Tạo Pull Request', close:'Đóng', insert:'Chèn vào chat', copy:'Sao chép', copied:'Đã sao chép', project:'Dự án', title:'Tiêu đề', url:'Link Pull Request', description:'Nội dung thay đổi', language:'Ngôn ngữ', recentCount:'Số emoji gần đây', recent:'Gần đây', common:'Emoji', missing:'Vui lòng nhập đủ thông tin và link http/https hợp lệ.', leave:'Tạo đơn nghỉ / Báo bận' },
        en: { emoji:'Recent emoji', settings:'THK-Chat settings', pr:'Create Pull Request', close:'Close', insert:'Insert into chat', copy:'Copy', copied:'Copied', project:'Project', title:'Title', url:'Pull Request URL', description:'Description', language:'Language', recentCount:'Recent emoji count', recent:'Recent', common:'Emoji', missing:'Complete all fields and enter a valid http/https link.', leave:'Create leave request' },
        ja: { emoji:'最近の絵文字', settings:'THK-Chat設定', pr:'プルリクエスト作成', close:'閉じる', insert:'チャットに挿入', copy:'コピー', copied:'コピーしました', project:'プロジェクト', title:'タイトル', url:'プルリクエストURL', description:'変更内容', language:'言語', recentCount:'最近の絵文字の表示数', recent:'最近使用', common:'絵文字', missing:'すべての項目を入力し、有効なhttp/httpsリンクを指定してください。', leave:'休暇申請を作成' }
    };
    function readSetting(key, fallback) { try { const value = localStorage.getItem('thk-toolkit.' + key); return value === null ? fallback : JSON.parse(value); } catch(e) { return fallback; } }
    function writeSetting(key, value) { try { localStorage.setItem('thk-toolkit.' + key, JSON.stringify(value)); } catch(e) {} }
    const settings = {
        language: readSetting('language', 'auto'),
        recentCount: Math.min(50, Math.max(1, Number(readSetting('recentCount', 12)) || 12))
    };
    function getLanguage() {
        const language = settings.language === 'auto' ? window.CW?.application?.languageCode?.value || document.documentElement.lang || navigator.language : settings.language;
        return String(language).startsWith('ja') ? 'ja' : String(language).startsWith('vi') ? 'vi' : 'en';
    }
    const t = key => translations[getLanguage()][key] || key;
    function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
    function button(text, action, className = 'thk-chip-btn') { const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node; }
    function field(parent, label, type = 'text', value = '') {
        const wrapper = element('label', 'thk-toolkit-label', label);
        const input = element(type === 'textarea' ? 'textarea' : 'input', 'thk-input-field');
        if (type !== 'textarea') input.type = type;
        input.value = value; wrapper.appendChild(input); parent.appendChild(wrapper); return input;
    }
    function getRoom() {
        const id = window.location.hash.match(/rid(\d+)/)?.[1] || String(window.RM?.id || window.CW?.roomId || '');
        const entity = window.CW?.application?.domainServiceContext?.roomService?.roomRepository?.entities?.[id];
        const name = entity?.name?.value || window.RM?.room_dat?.[id]?.name
            || document.querySelector('#_roomTitle, .roomTitle__name, .roomTitle, #currentSelectedRoomHeader h1, #currentSelectedRoomHeader h2, #currentSelectedRoomHeader [role=heading]')?.textContent?.trim() || '';
        return { id, name, entity };
    }
    function resolveAvatarUrl(value) {
        for (let depth=0; value && typeof value === 'object' && depth<4; depth++) value = value.value || value.url || value.src;
        if (typeof value !== 'string' || !value.trim()) return '';
        value = value.trim();
        try {
            if (/^\/?avatar\//i.test(value)) {
                const native = document.querySelector('#_timeLine img[src*="/avatar/"]');
                const origin = native?.src ? new URL(native.src).origin : 'https://appdata.chatwork.com';
                return new URL('/' + value.replace(/^\//, ''), origin).href;
            }
            const url = new URL(value, window.location.href || 'https://www.chatwork.com/');
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch(error) { return ''; }
    }
    const teamLoads = new Map();
    function getModernMembers() {
        const app = window.CW?.application;
        const room = getRoom().entity;
        if (!app || !room) return null;
        const ids = new Set(room.members?.map(member => String(member.userId.value)) || (room.mate ? [String(room.mate.value)] : []));
        const teams = app.domainServiceContext.teamService?.teamRepository?.entities || {};
        (room.relatedTeams?.value || []).forEach(team => {
            const id = team.identity.value;
            const members = teams[id]?.teamMembersEntity?.value?.teamMembers;
            if (members) members.forEach(member => ids.add(String(member.identity.value)));
            else if (!teamLoads.has(id)) {
                const service = app.applicationServiceContext?.teamAdditionAreaService;
                if (service?.fetchMember) {
                    teamLoads.set(id, true);
                    Promise.resolve().then(() => service.fetchMember(id)).then(() => {
                        document.dispatchEvent(new Event('thk-members-ready'));
                    }).catch(() => {}).finally(() => setTimeout(() => teamLoads.delete(id), 5000));
                }
            }
        });
        const users = app.domainServiceContext.userService?.userRepository?.entities || {};
        return [...ids].map(id => ({ id, name: users[id]?.name?.value || users[id]?.nickname?.value?.value, avatar: resolveAvatarUrl(users[id]?.profile?.profileImage?.value) })).filter(member => member.name);
    }
    let closePanel = null;
    function panel(title) {
        closePanel?.();
        document.getElementById('thkModalClose')?.click();
        document.getElementById('thkBtnClosePreview')?.click();
        const backdrop = element('div', 'thk-modal-backdrop'); backdrop.id = 'thk-toolkit-panel';
        const box = element('div', 'thk-modal-box thk-toolkit-box');
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
        const header = element('div', 'thk-modal-header');
        if (window.__thk_brand_icon_svg) { const icon = element('span', 'thk-brand-icon'); icon.innerHTML = window.__thk_brand_icon_svg; icon.setAttribute('aria-hidden', 'true'); header.appendChild(icon); }
        header.appendChild(element('strong', '', title));
        const body = element('div', 'thk-modal-body');
        const footer = element('div', 'thk-modal-footer');
        const previousFocus = document.activeElement;
        const cleanup = [];
        const close = () => {
            cleanup.forEach(fn => fn()); backdrop.remove();
            if (closePanel === close) closePanel = null;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
        closePanel = close;
        header.appendChild(button('×', close, 'thk-modal-close'));
        footer.appendChild(button(t('close'), close, 'thk-btn-secondary'));
        box.append(header, body, footer); backdrop.appendChild(box); document.body.appendChild(backdrop);
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
            if (e.key === 'Tab') {
                const nodes = [...box.querySelectorAll('button:not([disabled]), input, textarea, select, a[href]')];
                const first = nodes[0], last = nodes[nodes.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
        };
        window.addEventListener('keydown', onKey, true);
        cleanup.push(() => window.removeEventListener('keydown', onKey, true));
        backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
        header.querySelector('button').focus();
        return { body, footer, close, cleanup, backdrop };
    }
    function getEditor() { return window.__thk_getChatText?.() || document.querySelector('#_chatText') || document.querySelector('#CurrentSelectedRoom textarea'); }
    function insert(text) {
        const chat = getEditor();
        if (!chat) return false;
        chat.focus();
        const start = chat.selectionStart, end = chat.selectionEnd;
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch(e) {}
        if (!ok) {
            const value = chat.value.slice(0, start) + text + chat.value.slice(end);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype || {}, 'value')?.set;
            if (setter) setter.call(chat, value); else chat.value = value;
            chat.setSelectionRange(start + text.length, start + text.length);
            chat.dispatchEvent(new Event('input', { bubbles: true }));
            chat.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }
    async function copy(text) {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
        const input = element('textarea'); input.value = text; document.body.appendChild(input); input.select();
        try { if (!document.execCommand('copy')) throw new Error(t('copy')); } finally { input.remove(); }
    }
    function openSettings() {
        const view = panel(t('settings'));
        const languageLabel = element('label', 'thk-toolkit-label', t('language'));
        const select = element('select', 'thk-input-field');
        [['auto','Auto'],['vi','Tiếng Việt'],['en','English'],['ja','日本語']].forEach(([value,label]) => { const option = element('option', '', label); option.value = value; select.appendChild(option); });
        select.value = settings.language; languageLabel.appendChild(select); view.body.appendChild(languageLabel);
        select.addEventListener('change', () => { settings.language = select.value; writeSetting('language', select.value); syncToolbar(); openSettings(); });
        const count = field(view.body, t('recentCount'), 'number', settings.recentCount); count.min = '1'; count.max = '50'; count.step = '1';
        count.addEventListener('change', () => { settings.recentCount = Math.min(50, Math.max(1, Math.round(Number(count.value) || 12))); count.value = settings.recentCount; writeSetting('recentCount', settings.recentCount); });

    }
    const commonEmoji = ['😀','😊','😂','👍','🙏','❤️','🎉','✅','👀','💪','🙇','😅',':)',':D','(bow)','(roger)','(thanks)'];
    let recentEmoji = readSetting('recentEmoji', []);
    if (!Array.isArray(recentEmoji)) recentEmoji = [];
    recentEmoji = recentEmoji.filter(value => typeof value === 'string' && value.length < 40).slice(0, 50);
    function rememberEmoji(values) {
        if (!values.length) return;
        values.forEach(value => { recentEmoji = [value, ...recentEmoji.filter(item => item !== value)].slice(0, 50); });
        writeSetting('recentEmoji', recentEmoji);
    }
    function addedText(before, after) {
        let start = 0, oldEnd = before.length, newEnd = after.length;
        while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
        // Do not split a UTF-16 surrogate pair.
        if (start && /[\uD800-\uDBFF]/.test(after[start - 1])) start--;
        while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
        if (newEnd === start) return '';
        if (Intl.Segmenter) {
            for (const item of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(after)) {
                const end = item.index + item.segment.length;
                if (item.index < start && end > start) start = item.index;
                if (item.index < newEnd && end > newEnd) newEnd = end;
            }
        }
        return after.slice(start, newEnd);
    }
    function findEmoji(text) {
        const values = [];
        if (Intl.Segmenter) {
            for (const item of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
                if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(item.segment)) values.push(item.segment);
            }
        }
        commonEmoji.filter(value => value.length > 1 && /^[(:]/.test(value)).forEach(value => { if (text.includes(value)) values.push(value); });
        return values;
    }
    let lastEditor = null, lastText = '';
    document.addEventListener('focusin', e => { if (e.target === getEditor() && e.target !== lastEditor) { lastEditor = e.target; lastText = e.target.value; } });
    document.addEventListener('input', e => {
        if (e.target !== getEditor() || e.isComposing) return;
        rememberPullRequestProject(e.target.value);
        rememberEmoji(findEmoji(addedText(lastEditor === e.target ? lastText : '', e.target.value)));
        lastEditor = e.target; lastText = e.target.value;
    });
    function openEmoji() {
        const view = panel(t('emoji'));
        function group(label, list) {
            view.body.appendChild(element('h4', '', label));
            const row = element('div', 'thk-chips-row');
            list.forEach(value => row.appendChild(button(value, () => { view.close(); if (insert(value)) rememberEmoji([value]); }, 'thk-chip-btn thk-emoji-choice')));
            view.body.appendChild(row);
        }
        group(t('recent'), recentEmoji.slice(0, settings.recentCount)); group(t('common'), commonEmoji);
    }
    function formatPullRequest(project = '', url = '', spec = '', reviewTime = '') {
        return '[toall]\n[info]\nProject name: ' + project.trim() + '\nPull Request: ' + url.trim()
            + '\nSpec: ' + spec.trim() + '\nThời gian review dự kiến: ' + reviewTime.trim() + '\n[/info]\n';
    }
    function rememberPullRequestProject(text) {
        const blocks = [...text.matchAll(/\[info\]\s*Project name:[ \t]*([^\r\n]*)\r?\nPull Request:[\s\S]*?\r?\nSpec:[\s\S]*?\r?\nThời gian review dự kiến:[\s\S]*?\[\/info\]/g)];
        if (blocks.length) writeSetting('prProject', blocks[blocks.length - 1][1].trim());
    }
    function insertPullRequest() {
        closePanel?.();
        const chat = getEditor();
        if (!chat) return;
        const saved = readSetting('prProject', '');
        const project = typeof saved === 'string' ? saved : '';
        const start = chat.selectionStart;
        const text = (start > 0 && chat.value[start - 1] !== '\n' ? '\n' : '') + formatPullRequest(project);
        if (insert(text)) {
            const label = project ? 'Pull Request: ' : 'Project name: ';
            const caret = start + text.indexOf(label) + label.length;
            chat.setSelectionRange(caret, caret);
        }
    }

    const labels = {
        '4. Tag leader (có thể chọn nhiều người)': ['4. Leaders (select multiple)', '4. リーダー（複数選択可）'],
        '5. Lý do (Reason / 理由)': ['5. Reason', '5. 理由'],
        'Tìm tên hoặc ID leader...': ['Search leaders by name or ID...', '名前またはIDでリーダーを検索...'],
        'Tải lại': ['Reload', '再読み込み'],
        'Mỗi leader được tag trên một dòng. Danh sách được nhớ sau khi sao chép, chèn hoặc gửi request.': ['Each leader is mentioned on a separate line. Your selection is saved after copying, inserting or sending a request.', '各リーダーを1行ずつメンションします。コピー・挿入・送信後に選択内容を保存します。'],
        'Không tìm thấy leader phù hợp.': ['No matching leaders.', '該当するリーダーはいません。'],
        'Chưa tải được danh sách thành viên. Bấm Tải lại để thử lại.': ['Members are not loaded yet. Click Reload to try again.', 'メンバーを読み込めませんでした。再読み込みしてください。'],
        'Chưa tải được thông tin một số leader đã lưu. Bấm Tải lại hoặc bỏ chọn leader đó.': ['Some saved leaders have not loaded. Reload or remove those selections.', '保存済みリーダーの一部を読み込めませんでした。再読み込みするか選択を解除してください。'],
        'Phòng chat đã thay đổi. Vui lòng mở lại form request.': ['The chat room changed. Please reopen the request form.', 'チャットが変更されました。申請フォームを開き直してください。'],
        'Mã tin nhắn': ['Message source', 'メッセージのソース'],
        'Tạo Đơn Nghỉ / Báo Bận Nhanh': ['Create Leave / Absence Request', '休暇・不在申請を作成'],
        '1. Chọn loại yêu cầu (Request)': ['1. Request type', '1. 申請種別'],
        '2. Ngày nghỉ (có thể chọn nhiều ngày)': ['2. Leave dates (multiple selection)', '2. 休暇日（複数選択可）'],
        '3. Thời gian nghỉ (áp dụng cho mọi ngày đã chọn)': ['3. Time (applies to all selected dates)', '3. 時間（選択したすべての日に適用）'],
        '4. Lý do (Reason / 理由)': ['4. Reason', '4. 理由'],
        'Từ ngày': ['Start date', '開始日'], 'Đến ngày (tùy chọn)': ['End date (optional)', '終了日（任意）'],
        'Thêm ngày / khoảng ngày': ['Add date / date range', '日付・期間を追加'],
        'Bỏ chọn tất cả': ['Clear dates', '日付をクリア'],
        'Thêm từng ngày rời rạc hoặc cả khoảng ngày. Bấm vào ngày đã chọn để bỏ ngày đó.': ['Add individual dates or a date range. Click a selected date to remove it.', '日付または期間を追加できます。選択済みの日付をクリックすると解除できます。'],
        'Từ giờ': ['Start time', '開始時刻'], 'Đến giờ': ['End time', '終了時刻'],
        'Ngôn ngữ lý do gợi ý': ['Suggested reason language', '理由の言語'],
        'Xem trước tin nhắn': ['Message preview', 'メッセージのプレビュー'],
        'Sao chép': ['Copy', 'コピー'], 'Sao chép nội dung': ['Copy content', '内容をコピー'], '✓ Đã chép!': ['✓ Copied!', '✓ コピーしました'],
        'Hủy (Esc)': ['Cancel (Esc)', 'キャンセル (Esc)'], 'Đóng (Esc)': ['Close (Esc)', '閉じる (Esc)'],
        'Chèn vào chat': ['Insert into chat', 'チャットに挿入'], 'Gửi ngay': ['Send now', '今すぐ送信'],
        'Nghỉ phép năm': ['Paid leave', '有給休暇'], 'Nghỉ nửa ngày': ['Half-day paid leave', '半日有給休暇'],
        'Đi muộn': ['Late arrival', '遅刻'], 'Về sớm': ['Early departure', '早退'], 'Nghỉ giữa giờ': ['Temporary absence', '中抜け'],
        'Nghỉ không lương': ['Unpaid leave', '無給休暇'], 'Nghỉ nửa ngày KL': ['Half-day unpaid leave', '半日無給休暇'],
        'Đổi ca / Lịch': ['Schedule change', '勤務時間変更'], 'Hủy đơn đã gửi': ['Cancel previous request', '申請取消'],
        'Vui lòng chọn ngày hợp lệ.': ['Select a valid date.', '有効な日付を選択してください。'],
        'Ngày kết thúc phải từ ngày bắt đầu trở đi.': ['End date must be on or after the start date.', '終了日は開始日以降にしてください。'],
        'Vui lòng chọn ít nhất một ngày nghỉ.': ['Select at least one leave date.', '休暇日を1日以上選択してください。'],
        'Vui lòng nhập đủ giờ bắt đầu và kết thúc.': ['Enter both start and end times.', '開始時刻と終了時刻を入力してください。'],
        'Giờ kết thúc phải sau giờ bắt đầu.': ['End time must be after the start time.', '終了時刻は開始時刻より後にしてください。'],
        'Vui lòng chọn hoặc nhập lý do nghỉ.': ['Choose or enter a reason.', '理由を選択または入力してください。'],
        '✓ Đã tag': ['✓ Tagged', '✓ 選択済み'], 'Gửi thông báo tới cả phòng': ['Notify everyone in the room', 'チャットの全員に通知'],
        '@ALL (Tất cả thành viên)': ['@ALL (All members)', '@ALL（全員）'],
        'Tag thành viên (@ / Ctrl+M / Cmd+M)': ['Mention (@ / Ctrl+M / Cmd+M)', 'メンション (@ / Ctrl+M / Cmd+M)'],
        'Tag tất cả ([To:all])': ['Mention everyone ([To:all])', '全員にメンション ([To:all])'],
        'Thẻ Info (Ctrl+I / Cmd+I)': ['Info (Ctrl+I / Cmd+I)', '情報枠 (Ctrl+I / Cmd+I)'],
        'Thẻ Info có Tiêu đề (Ctrl+Shift+I / Cmd+Shift+I)': ['Info with title (Ctrl+Shift+I / Cmd+Shift+I)', 'タイトル付き情報枠 (Ctrl+Shift+I / Cmd+Shift+I)'],
        'Thẻ Code (Ctrl+K / Cmd+K)': ['Code (Ctrl+K / Cmd+K)', 'コード (Ctrl+K / Cmd+K)'],
        'Đường kẻ ngang [hr] (Ctrl+H / Cmd+H)': ['Horizontal rule [hr] (Ctrl+H / Cmd+H)', '水平線 [hr] (Ctrl+H / Cmd+H)']
    };
    const translatedNodes = new WeakMap();
    function translateLabel(value) { const entry = labels[value]; return entry && getLanguage() !== 'vi' ? entry[getLanguage() === 'ja' ? 1 : 0] : value; }
    function localize() {
        document.querySelectorAll('#thk-toolbar-inline, #thk-modal-backdrop, .thk-mention-dropdown').forEach(root => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (node.parentElement?.closest('.thk-preview-raw, .thk-chat-preview, .thk-mention-name, .thk-leader-option, #thkSelectedLeaders')) continue;
                const current = node.textContent.trim();
                const previous = translatedNodes.get(node);
                const source = previous?.rendered === current ? previous.source : current;
                if (!labels[source]) continue;
                const rendered = translateLabel(source);
                translatedNodes.set(node, { source, rendered });
                if (current !== rendered) node.textContent = node.textContent.replace(current, rendered);
            }
            root.querySelectorAll('[title], [placeholder]').forEach(el => {
                ['title','placeholder'].forEach(attr => {
                    const current = el.getAttribute(attr); if (!current) return;
                    let cache = translatedNodes.get(el); if (!cache) { cache = {}; translatedNodes.set(el, cache); }
                    const source = cache[attr]?.rendered === current ? cache[attr].source : current;
                    const rendered = translateLabel(source); cache[attr] = { source, rendered };
                    if (current !== rendered) el.setAttribute(attr, rendered);
                });
            });
        });
    }
    function syncToolbar() {
        localize();
        const toolbar = document.getElementById('thk-toolbar-inline');
        if (!toolbar) return;
        const roomName = getRoom().name;
        const leave = toolbar.querySelector('#thkBtnLeaveRequest');
        if (leave) { const hidden = !roomName.includes('Attendance infor_THKHN'); if (leave.hidden !== hidden) leave.hidden = hidden; if (leave.title !== t('leave')) leave.title = t('leave'); }
        const actions = [ ['emoji','☺',openEmoji], ['pr','PR',insertPullRequest], ['settings','⚙',openSettings] ];
        actions.forEach(([key,icon,action]) => {
            let node = toolbar.querySelector('#thkToolkit-' + key);
            if (!node) { node = button(icon, action, 'thk-icon-btn'); node.id = 'thkToolkit-' + key; node.addEventListener('mousedown', e => e.preventDefault()); toolbar.appendChild(node); }
            if (node.title !== t(key)) { node.title = t(key); node.setAttribute('aria-label', t(key)); }
            if (key === 'pr') { const hidden = !roomName.includes('【HN】Source Code Review'); if (node.hidden !== hidden) node.hidden = hidden; }
        });
    }
    function start() {
        if (!document.getElementById('thk-toolkit-styles')) {
            const style = element('style'); style.id = 'thk-toolkit-styles';
            style.textContent = [
                '.thk-icon-btn[hidden]{display:none!important}',
                '.thk-toolkit-box,.thk-modal-box{max-height:94vh!important;display:flex!important;flex-direction:column!important}',
                '.thk-modal-body{min-height:0!important;flex:1!important}.thk-modal-footer{flex-wrap:wrap!important}',
                '.thk-toolkit-label{display:block;font-size:12px}.thk-toolkit-label input,.thk-toolkit-label textarea{margin-top:5px!important}',
                '.thk-toolkit-check{display:flex;gap:8px;align-items:center}.thk-emoji-choice{font-size:20px!important;min-width:40px}',
            ].join('\n') + '\n' + (window.__thk_ui_css || ''); document.head.appendChild(style);
        }
        document.documentElement.classList.remove('thk-compact');
        syncToolbar();
        const observer = new MutationObserver(() => syncToolbar()); observer.observe(document.body, {childList:true,subtree:true});
        window.addEventListener('hashchange', () => { closePanel?.(); syncToolbar(); });
        setInterval(syncToolbar, 1500);
    }
    window.__thkToolkit = { getRoom, getRoomMembers: getModernMembers, translate: translateLabel, resolveAvatarUrl, close: () => closePanel?.(), openSettings, insertPullRequest };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
