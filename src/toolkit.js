(function() {
    'use strict';
    const translations = {
        vi: { emoji:'Emoji gần đây', settings:'Cài đặt THK-Chat', pr:'Tạo Pull Request', close:'Đóng', insert:'Chèn vào chat', copy:'Sao chép', copied:'Đã sao chép', project:'Dự án', title:'Tiêu đề', url:'Link Pull Request', description:'Nội dung thay đổi', language:'Ngôn ngữ', recentCount:'Số emoji gần đây', recent:'Gần đây', common:'Emoji', missing:'Vui lòng nhập đủ thông tin và link http/https hợp lệ.', leave:'Tạo đơn nghỉ / Báo bận' },
        en: { emoji:'Recent emoji', settings:'THK-Chat settings', pr:'Create Pull Request', close:'Close', insert:'Insert into chat', copy:'Copy', copied:'Copied', project:'Project', title:'Title', url:'Pull Request URL', description:'Description', language:'Language', recentCount:'Recent emoji count', recent:'Recent', common:'Emoji', missing:'Complete all fields and enter a valid http/https link.', leave:'Create leave request' },
        ja: { emoji:'最近の絵文字', settings:'THK-Chat設定', pr:'プルリクエスト作成', close:'閉じる', insert:'チャットに挿入', copy:'コピー', copied:'コピーしました', project:'プロジェクト', title:'タイトル', url:'プルリクエストURL', description:'変更内容', language:'言語', recentCount:'最近の絵文字の表示数', recent:'最近使用', common:'絵文字', missing:'すべての項目を入力し、有効なhttp/httpsリンクを指定してください。', leave:'休暇申請を作成' }
    };
    Object.assign(translations.vi, { files:'Quản lý file', shortcuts:'Shortcut hiển thị trong nhóm', shortcutHint:'Ẩn/hiện nút trên thanh soạn tin và cấu hình phím tắt.', scope:'Áp dụng cho', allRooms:'Tất cả các nhóm', thisRoom:'Nhóm hiện tại', inherit:'Dùng thiết lập chung', updates:'Kiểm tra cập nhật app', info:'Info', infoTitle:'Info có tiêu đề', code:'Code', hr:'Đường kẻ', preview:'Xem trước', customKey:'Phím tắt', pressKey:'Bấm phím...', noKey:'Chưa gán', roomTree:'Cây thư mục phòng', addFolder:'+ Thư mục', autoGroup:'⚡ Tự động gom', folderName:'Tên thư mục', parentFolder:'Thư mục cha', rootFolder:'[Thư mục gốc]', selectRooms:'Chọn phòng đưa vào thư mục', save:'Lưu', delete:'Xóa', edit:'Sửa' });
    Object.assign(translations.en, { files:'Files', shortcuts:'Group toolbar shortcuts', shortcutHint:'Choose toolbar buttons and configure shortcuts.', scope:'Apply to', allRooms:'All groups', thisRoom:'This group', inherit:'Use global settings', updates:'Check for app updates', info:'Info', infoTitle:'Info with title', code:'Code', hr:'Divider', preview:'Preview', customKey:'Shortcut key', pressKey:'Press key...', noKey:'None', roomTree:'Room folders', addFolder:'+ Folder', autoGroup:'⚡ Auto group', folderName:'Folder name', parentFolder:'Parent folder', rootFolder:'[Root folder]', selectRooms:'Select rooms', save:'Save', delete:'Delete', edit:'Edit' });
    Object.assign(translations.ja, { files:'ファイル管理', shortcuts:'グループのツールバー', shortcutHint:'ツールバーボタンの表示とショートカットキーを設定します。', scope:'適用範囲', allRooms:'すべてのグループ', thisRoom:'このグループ', inherit:'共通設定を使用', updates:'アプリの更新を確認', info:'Info', infoTitle:'タイトル付きInfo', code:'Code', hr:'区切り線', preview:'プレビュー', customKey:'ショートカット', pressKey:'キーを押してください...', noKey:'未設定', roomTree:'ルームフォルダ', addFolder:'+ フォルダ', autoGroup:'⚡ 自動グループ化', folderName:'フォルダ名', parentFolder:'親フォルダ', rootFolder:'[ルートフォルダ]', selectRooms:'ルームを選択', save:'保存', delete:'削除', edit:'編集' });
    function readSetting(key, fallback) { try { const value = localStorage.getItem('thk-toolkit.' + key); return value === null ? fallback : JSON.parse(value); } catch(e) { return fallback; } }
    function writeSetting(key, value) { try { localStorage.setItem('thk-toolkit.' + key, JSON.stringify(value)); return true; } catch(e) { return false; } }
    const settings = {
        language: readSetting('language', 'auto')
    };
    function getLanguage() {
        const language = settings.language === 'auto' ? window.CW?.application?.languageCode?.value || document.documentElement.lang || navigator.language : settings.language;
        return String(language).startsWith('ja') ? 'ja' : String(language).startsWith('vi') ? 'vi' : 'en';
    }
    const t = key => translations[getLanguage()][key] || key;
    const shortcuts = [ ['info','thkBtnInfo'], ['infoTitle','thkBtnInfoTitle'], ['code','thkBtnCode'], ['hr','thkBtnHr'], ['leave','thkBtnLeaveRequest'], ['preview','thkBtnMarkdownPreview'], ['pr','thkToolkit-pr'], ['files','thkToolkit-files'] ];
    function toolbarPreferences(roomId = getRoom().id) {
        const global = readSetting('toolbar', {});
        const local = roomId ? readSetting('toolbar.room.' + roomId, {}) : {};
        return { ...(global && typeof global === 'object' ? global : {}), ...(local && typeof local === 'object' ? local : {}) };
    }
    function defaultShortcutVisible(key, room = getRoom()) {
        return key === 'leave' ? room.name.includes('Attendance infor_THKHN') : key === 'pr' ? room.name.includes('【HN】Source Code Review') : true;
    }
    function shortcutVisible(key, room = getRoom()) {
        const value = toolbarPreferences(room.id)[key];
        return typeof value === 'boolean' ? value : defaultShortcutVisible(key, room);
    }
    const settingMessages = {
        vi:{saved:'Đã lưu và áp dụng.',failed:'Không lưu được cấu hình. Vui lòng thử lại.',overrides:'Nhóm này có cấu hình riêng, được ưu tiên hơn cấu hình chung.'},
        en:{saved:'Saved and applied.',failed:'Could not save settings. Please try again.',overrides:'This group has its own settings, which override global settings.'},
        ja:{saved:'保存して適用しました。',failed:'設定を保存できませんでした。再試行してください。',overrides:'このグループの個別設定は共通設定より優先されます。'}
    };
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
    const defaultShortkeys = {
        info: 'Ctrl+I',
        infoTitle: 'Ctrl+Shift+I',
        code: 'Ctrl+K',
        hr: 'Ctrl+H',
        leave: 'Ctrl+Shift+L',
        preview: 'Ctrl+Shift+P',
        pr: 'Ctrl+Shift+R',
        files: 'Ctrl+Shift+F'
    };
    function getShortkeys() {
        const custom = readSetting('shortkeys', {});
        return { ...defaultShortkeys, ...(custom && typeof custom === 'object' ? custom : {}) };
    }
    function setShortkey(key, combo) {
        const custom = readSetting('shortkeys', {});
        const updated = { ...(custom && typeof custom === 'object' ? custom : {}) };
        if (!combo) delete updated[key]; else updated[key] = combo;
        writeSetting('shortkeys', updated);
    }
    function formatKeyCombo(e) {
        const isMac = navigator.platform?.toUpperCase().includes('MAC');
        const parts = [];
        if (e.ctrlKey || (!isMac && e.metaKey)) parts.push('Ctrl');
        if (isMac && e.metaKey) parts.push('Cmd');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        let key = e.key;
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
        if (key === ' ') key = 'Space';
        else if (key && key.length === 1) key = key.toUpperCase();
        parts.push(key);
        return parts.join('+');
    }
    function matchCombo(e, combo) {
        if (!combo || typeof combo !== 'string') return false;
        const parts = combo.split('+').map(p => p.trim());
        const hasCtrl = parts.includes('Ctrl') || parts.includes('Cmd');
        const hasShift = parts.includes('Shift');
        const hasAlt = parts.includes('Alt');
        const keyPart = parts[parts.length - 1].toLowerCase();
        if ((e.ctrlKey || e.metaKey) !== hasCtrl) return false;
        if (e.shiftKey !== hasShift) return false;
        if (e.altKey !== hasAlt) return false;
        const eventKey = (e.key === ' ' ? 'Space' : e.key).toLowerCase();
        return eventKey === keyPart;
    }
    function triggerShortcutAction(name) {
        if (name === 'info') {
            const btn = document.getElementById('thkBtnInfo');
            if (btn) btn.click(); else insert('[info][/info]');
        } else if (name === 'infoTitle') {
            const btn = document.getElementById('thkBtnInfoTitle');
            if (btn) btn.click(); else insert('[info][title][/title][/info]');
        } else if (name === 'code') {
            const btn = document.getElementById('thkBtnCode');
            if (btn) btn.click(); else insert('[code][/code]');
        } else if (name === 'hr') {
            const btn = document.getElementById('thkBtnHr');
            if (btn) btn.click(); else insert('[hr]');
        } else if (name === 'leave') {
            const btn = document.getElementById('thkBtnLeaveRequest');
            if (btn) btn.click();
        } else if (name === 'preview') {
            const btn = document.getElementById('thkBtnMarkdownPreview');
            if (btn) btn.click();
        } else if (name === 'pr') {
            const btn = document.getElementById('thkToolkit-pr');
            if (btn) btn.click(); else insertPullRequest();
        } else if (name === 'files') {
            window.__thkFiles?.open();
        }
    }
    window.__thk_matchCustomShortkey = function(e) {
        const keys = getShortkeys();
        for (const [name, combo] of Object.entries(keys)) {
            if (matchCombo(e, combo)) {
                e.preventDefault();
                triggerShortcutAction(name);
                return true;
            }
        }
        return false;
    };
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('keydown', e => {
            if (document.querySelector && document.querySelector('.thk-shortkey-badge.recording')) return;
            window.__thk_matchCustomShortkey?.(e);
        }, true);
    }

    function openSettings() {
        const view = panel(t('settings'));
        const languageLabel = element('label', 'thk-toolkit-label', t('language'));
        const select = element('select', 'thk-input-field');
        [['auto','Auto'],['vi','Tiếng Việt'],['en','English'],['ja','日本語']].forEach(([value,label]) => { const option = element('option', '', label); option.value = value; select.appendChild(option); });
        select.value = settings.language; languageLabel.appendChild(select); view.body.appendChild(languageLabel);
        select.addEventListener('change', () => { settings.language = select.value; writeSetting('language', select.value); syncToolbar(); openSettings(); });
        view.body.appendChild(element('h3', 'thk-sec-title', t('shortcuts')));
        view.body.appendChild(element('p', 'thk-leave-hint', t('shortcutHint')));

        const room = getRoom();
        const scopeLabel = element('label', 'thk-toolkit-label', t('scope'));
        const scope = element('select', 'thk-input-field');
        const scopeOptions = [
            ...(room.id ? [['room', t('thisRoom') + (room.name ? ' (' + room.name + ')' : '')]] : []),
            ['all', t('allRooms')]
        ];
        scopeOptions.forEach(([val, lbl]) => {
            const opt = element('option', '', lbl);
            opt.value = val;
            scope.appendChild(opt);
        });
        scope.value = room.id ? 'room' : 'all';
        scopeLabel.appendChild(scope);
        view.body.appendChild(scopeLabel);

        const grid = element('div', 'thk-shortcut-grid');
        view.body.appendChild(grid);
        const status = element('p', 'thk-leave-hint');
        status.setAttribute('role', 'status');
        view.body.appendChild(status);

        const reset = button(t('inherit'), () => {
            if (room.id) {
                writeSetting('toolbar.room.' + room.id, {});
                drawShortcuts();
                syncToolbar();
                status.textContent = settingMessages[getLanguage()]['saved'];
            }
        }, 'thk-btn-secondary');
        view.body.appendChild(reset);

        function drawShortcuts() {
            grid.replaceChildren();
            const isRoom = scope.value === 'room';
            reset.hidden = !isRoom;
            const currentKeys = getShortkeys();
            const globalPrefs = readSetting('toolbar', {});
            const roomPrefs = room.id ? readSetting('toolbar.room.' + room.id, {}) : {};

            shortcuts.forEach(([name]) => {
                const row = element('div', 'thk-shortcut-option-row');
                const left = element('label', 'thk-shortcut-left');
                const check = element('input');
                check.type = 'checkbox';

                if (isRoom) {
                    check.checked = shortcutVisible(name, room);
                    check.disabled = !room.id;
                } else {
                    const val = globalPrefs[name];
                    check.checked = typeof val === 'boolean' ? val : defaultShortcutVisible(name, room);
                }

                left.append(check, element('span', '', t(name)));

                const currentCombo = currentKeys[name] || t('noKey');
                const keyBadge = button(currentCombo, null, 'thk-shortkey-badge');
                keyBadge.title = t('customKey');
                let recording = false;

                const onKeyRecord = e => {
                    if (!recording) return;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    if (e.key === 'Escape') {
                        recording = false;
                        keyBadge.classList.remove('recording');
                        keyBadge.textContent = currentKeys[name] || t('noKey');
                        window.removeEventListener('keydown', onKeyRecord, true);
                        return;
                    }
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                        recording = false;
                        keyBadge.classList.remove('recording');
                        setShortkey(name, '');
                        keyBadge.textContent = t('noKey');
                        window.removeEventListener('keydown', onKeyRecord, true);
                        status.textContent = settingMessages[getLanguage()]['saved'];
                        return;
                    }
                    const combo = formatKeyCombo(e);
                    if (combo) {
                        recording = false;
                        keyBadge.classList.remove('recording');
                        setShortkey(name, combo);
                        keyBadge.textContent = combo;
                        window.removeEventListener('keydown', onKeyRecord, true);
                        status.textContent = settingMessages[getLanguage()]['saved'];
                    }
                };

                keyBadge.addEventListener('click', () => {
                    if (recording) return;
                    recording = true;
                    keyBadge.classList.add('recording');
                    keyBadge.textContent = t('pressKey');
                    window.addEventListener('keydown', onKeyRecord, true);
                });
                view.cleanup.push(() => {
                    if (recording) window.removeEventListener('keydown', onKeyRecord, true);
                });

                row.append(left, keyBadge);
                grid.appendChild(row);

                check.addEventListener('change', () => {
                    let ok = false;
                    if (isRoom) {
                        if (getRoom().id !== room.id) { view.close(); return; }
                        const key = 'toolbar.room.' + room.id;
                        const saved = readSetting(key, {});
                        ok = writeSetting(key, { ...(saved && typeof saved === 'object' ? saved : {}), [name]: check.checked });
                    } else {
                        const saved = readSetting('toolbar', {});
                        ok = writeSetting('toolbar', { ...(saved && typeof saved === 'object' ? saved : {}), [name]: check.checked });
                    }
                    if (!ok) drawShortcuts();
                    syncToolbar();
                    status.textContent = settingMessages[getLanguage()][ok ? 'saved' : 'failed'];
                });
            });
        }

        scope.addEventListener('change', drawShortcuts);
        drawShortcuts();

        view.body.appendChild(element('h3','thk-sec-title','THK-Chat v__VERSION__'));
        view.body.appendChild(button(t('updates'), () => { view.close(); window.__thk_openUpdates?.(); }, 'thk-btn-secondary'));
    }
    document.addEventListener('input', e => {
        if (e.target === getEditor() && !e.isComposing) rememberPullRequestProject(e.target.value);
    });
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
        '2. Ngày và thời gian nghỉ': ['2. Leave dates and times','2. 休暇の日付と時間'],
        'Mỗi dòng là một ngày kèm khoảng giờ nghỉ riêng.': ['Each row has its own date and time range.','各行で日付と休暇時間を個別に指定します。'],
        'Ngày nghỉ': ['Leave date','休暇日'], 'Thêm ngày': ['Add date','日付を追加'],
        'Thêm nhiều ngày cùng khoảng giờ': ['Add a date range with matching times','同じ時間帯で複数の日付を追加'],
        'Thêm khoảng ngày': ['Add date range','期間を追加'], 'Đến ngày': ['End date','終了日'],
        '3. Tag leader (có thể chọn nhiều người)': ['3. Leaders (select multiple)','3. リーダー（複数選択可）'],
        'Vui lòng chọn ngày hợp lệ cho từng dòng.': ['Choose a valid date for each row.','各行で有効な日付を選択してください。'],
        'Mỗi ngày chỉ chọn một khoảng giờ nghỉ.': ['Choose one time range for each date.','各日付につき1つの時間帯を選択してください。'],
        'Chỉ chọn tối đa 366 ngày trong một lần.': ['Select up to 366 dates at a time.','一度に最大366日を選択できます。'],
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
                if (node.parentElement?.closest('.thk-preview-raw, .thk-chat-preview, .thk-mention-name, .thk-leader-option, #thkSelectedLeaders, .thk-file-name, .thk-file-meta, .thk-file-preview-name, .thk-file-preview-content')) continue;
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
    function getAllRooms() {
        const map = new Map();
        const entities = window.CW?.application?.domainServiceContext?.roomService?.roomRepository?.entities;
        if (entities && typeof entities === 'object') {
            for (const [id, entity] of Object.entries(entities)) {
                const name = entity?.name?.value || '';
                const unread = Number(entity?.unreadNumber?.value ?? entity?.unread_num ?? 0) || 0;
                map.set(String(id), { id: String(id), name, unread });
            }
        }
        if (window.RM?.room_dat && typeof window.RM.room_dat === 'object') {
            for (const [id, room] of Object.entries(window.RM.room_dat)) {
                const prev = map.get(String(id));
                map.set(String(id), { id: String(id), name: room.name || prev?.name || '', unread: Number(room.unread_num ?? prev?.unread ?? 0) || 0 });
            }
        }
        if (map.size === 0 && typeof document.querySelectorAll === 'function') {
            document.querySelectorAll('#_roomListArea [data-rid], #RoomList [data-rid], .roomListItem').forEach(el => {
                const id = el.getAttribute('data-rid') || el.id?.match(/\d+/)?.[0];
                const name = el.querySelector('.roomTitle, .name, [role=heading]')?.textContent?.trim() || '';
                const unread = Number(el.querySelector('.unread, .roomBadge, ._unreadBadge')?.textContent?.trim()) || 0;
                if (id) map.set(String(id), { id: String(id), name, unread });
            });
        }
        return [...map.values()];
    }

    function getRoomTree() {
        const raw = readSetting('roomTree', []);
        return Array.isArray(raw) ? raw : [];
    }
    function saveRoomTree(tree) {
        return writeSetting('roomTree', tree);
    }

    function computeFolderTotalUnread(folder, roomsMap) {
        let count = 0;
        (folder.rooms || []).forEach(rid => {
            count += (roomsMap.get(String(rid))?.unread || 0);
        });
        (folder.children || []).forEach(child => {
            count += computeFolderTotalUnread(child, roomsMap);
        });
        return count;
    }

    function autoGroupRooms() {
        const rooms = getAllRooms();
        if (!rooms.length) return false;
        const rootFolders = [];
        function getOrCreateFolder(list, name) {
            let found = list.find(f => f.name.toLowerCase() === name.toLowerCase());
            if (!found) {
                found = {
                    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    name,
                    collapsed: false,
                    rooms: [],
                    children: []
                };
                list.push(found);
            }
            return found;
        }

        rooms.forEach(room => {
            const raw = room.name.trim();
            let parts = [];
            const bracketMatch = raw.match(/^([\[【][^\]】]+[\]】])\s*(.*)$/);
            if (bracketMatch) {
                const tag = bracketMatch[1].replace(/[\[\]【】]/g, '').trim();
                const rest = bracketMatch[2].trim();
                if (tag) parts.push(tag);
                if (rest) parts.push(...rest.split(/\s*[\/\-]\s*/).filter(Boolean));
            } else {
                parts = raw.split(/\s*[\/\-]\s*/).filter(Boolean);
            }

            if (parts.length > 1) {
                const folderParts = parts.slice(0, parts.length > 1 ? -1 : 1);
                let currentList = rootFolders;
                folderParts.forEach((folderName, idx) => {
                    const f = getOrCreateFolder(currentList, folderName);
                    if (idx === folderParts.length - 1) {
                        if (!f.rooms.includes(room.id)) f.rooms.push(room.id);
                    }
                    currentList = f.children;
                });
            }
        });

        if (rootFolders.length) {
            saveRoomTree(rootFolders);
            mountRoomTree(true);
            return true;
        }
        return false;
    }

    function openFolderModal(folderToEdit = null, parentId = null) {
        const isEdit = Boolean(folderToEdit);
        const view = panel(isEdit ? t('edit') + ' ' + folderToEdit.name : t('addFolder'));
        const allRooms = getAllRooms();
        const tree = getRoomTree();

        const nameInput = field(view.body, t('folderName'), 'text', folderToEdit?.name || '');

        const parentLabel = element('label', 'thk-toolkit-label', t('parentFolder'));
        const parentSelect = element('select', 'thk-input-field');
        const rootOpt = element('option', '', t('rootFolder'));
        rootOpt.value = '';
        parentSelect.appendChild(rootOpt);

        function flattenFolders(list, prefix = '') {
            list.forEach(f => {
                if (folderToEdit && f.id === folderToEdit.id) return;
                const opt = element('option', '', prefix + '📁 ' + f.name);
                opt.value = f.id;
                parentSelect.appendChild(opt);
                if (f.children?.length) flattenFolders(f.children, prefix + '— ');
            });
        }
        flattenFolders(tree);
        if (parentId) parentSelect.value = parentId;
        parentLabel.appendChild(parentSelect);
        view.body.appendChild(parentLabel);

        view.body.appendChild(element('label', 'thk-toolkit-label', t('selectRooms')));
        const searchInput = element('input', 'thk-input-field');
        searchInput.placeholder = 'Tìm tên phòng...';
        view.body.appendChild(searchInput);

        const roomBox = element('div', 'thk-shortcut-grid');
        roomBox.style.maxHeight = '200px';
        roomBox.style.overflowY = 'auto';
        roomBox.style.margin = '8px 0';
        view.body.appendChild(roomBox);

        const selectedRooms = new Set(folderToEdit?.rooms || []);
        function renderRoomChoices(query = '') {
            roomBox.replaceChildren();
            const q = query.toLowerCase();
            allRooms.filter(r => !q || r.name.toLowerCase().includes(q)).forEach(r => {
                const label = element('label', 'thk-shortcut-option');
                const chk = element('input');
                chk.type = 'checkbox';
                chk.checked = selectedRooms.has(r.id);
                chk.addEventListener('change', () => {
                    if (chk.checked) selectedRooms.add(r.id); else selectedRooms.delete(r.id);
                });
                label.append(chk, element('span', '', r.name || r.id));
                roomBox.appendChild(label);
            });
        }
        renderRoomChoices();
        searchInput.addEventListener('input', () => renderRoomChoices(searchInput.value));

        const saveBtn = button(t('save'), () => {
            const name = nameInput.value.trim();
            if (!name) return;
            const targetTree = getRoomTree();

            function removeNode(list, id) {
                const idx = list.findIndex(node => node.id === id);
                if (idx >= 0) return list.splice(idx, 1)[0];
                for (const node of list) {
                    if (node.children) {
                        const res = removeNode(node.children, id);
                        if (res) return res;
                    }
                }
                return null;
            }

            function insertNode(list, targetParentId, nodeToInsert) {
                if (!targetParentId) {
                    list.push(nodeToInsert);
                    return true;
                }
                for (const item of list) {
                    if (item.id === targetParentId) {
                        item.children = item.children || [];
                        item.children.push(nodeToInsert);
                        return true;
                    }
                    if (item.children && insertNode(item.children, targetParentId, nodeToInsert)) return true;
                }
                return false;
            }

            const targetParent = parentSelect.value || null;
            if (isEdit) {
                const existing = removeNode(targetTree, folderToEdit.id) || folderToEdit;
                existing.name = name;
                existing.rooms = [...selectedRooms];
                if (!insertNode(targetTree, targetParent, existing)) targetTree.push(existing);
            } else {
                const newNode = {
                    id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    name,
                    collapsed: false,
                    rooms: [...selectedRooms],
                    children: []
                };
                if (!insertNode(targetTree, targetParent, newNode)) targetTree.push(newNode);
            }

            saveRoomTree(targetTree);
            mountRoomTree(true);
            view.close();
        }, 'thk-btn-primary');

        view.footer.prepend(saveBtn);

        if (isEdit) {
            const delBtn = button(t('delete'), () => {
                const targetTree = getRoomTree();
                function removeRec(list, id) {
                    const idx = list.findIndex(node => node.id === id);
                    if (idx >= 0) { list.splice(idx, 1); return true; }
                    for (const node of list) {
                        if (node.children && removeRec(node.children, id)) return true;
                    }
                    return false;
                }
                removeRec(targetTree, folderToEdit.id);
                saveRoomTree(targetTree);
                mountRoomTree(true);
                view.close();
            }, 'thk-btn-secondary');
            delBtn.style.color = '#e05252';
            view.footer.prepend(delBtn);
        }
    }

    function mountRoomTree(forceRerender = false) {
        if (typeof document.querySelector !== 'function') return;
        const sidebar = document.querySelector('#_roomListArea, #RoomList, .roomList, #_sideContent');
        if (!sidebar) return;

        let panelNode = document.getElementById('thk-room-tree-panel');
        if (!panelNode) {
            panelNode = element('div', '');
            panelNode.id = 'thk-room-tree-panel';
            if (sidebar.parentElement) sidebar.parentElement.insertBefore(panelNode, sidebar);
            else if (typeof sidebar.prepend === 'function') sidebar.prepend(panelNode);
            else sidebar.appendChild(panelNode);
            forceRerender = true;
        }

        if (!forceRerender && panelNode.dataset?.rendered) {
            const currentRoomId = getRoom().id;
            panelNode.querySelectorAll('.thk-tree-row[data-rid]').forEach(row => {
                const rid = row.getAttribute('data-rid');
                if (rid === currentRoomId) row.classList.add('active'); else row.classList.remove('active');
            });
            return;
        }

        if (panelNode.dataset) panelNode.dataset.rendered = 'true';
        panelNode.replaceChildren();

        const tree = getRoomTree();
        const allRooms = getAllRooms();
        const roomsMap = new Map(allRooms.map(r => [r.id, r]));
        const currentRoomId = getRoom().id;

        const header = element('div', 'thk-tree-header');
        const title = element('span', 'thk-tree-title', '📁 ' + t('roomTree'));
        const actions = element('div', 'thk-tree-actions');

        const addBtn = button(t('addFolder'), () => openFolderModal(), 'thk-tree-btn');
        const autoBtn = button(t('autoGroup'), () => {
            if (autoGroupRooms()) {
                mountRoomTree(true);
            }
        }, 'thk-tree-btn');

        actions.append(addBtn, autoBtn);
        header.append(title, actions);
        panelNode.appendChild(header);

        if (!tree.length) {
            const emptyHint = element('div', 'thk-leave-hint', 'Chưa có thư mục. Bấm "+ Thư mục" hoặc "⚡ Tự động gom" để tạo cây thư mục.');
            emptyHint.style.padding = '6px 0';
            panelNode.appendChild(emptyHint);
            return;
        }

        function renderFolder(folder, container) {
            const node = element('div', 'thk-tree-node');
            const row = element('div', 'thk-tree-row');
            const totalUnread = computeFolderTotalUnread(folder, roomsMap);

            const label = element('div', 'thk-tree-label');
            const icon = element('span', '', folder.collapsed ? '📁 ' : '📂 ');
            const nameSpan = element('span', '', folder.name);
            label.append(icon, nameSpan);
            row.appendChild(label);

            if (totalUnread > 0) {
                const badge = element('span', 'thk-tree-badge', String(totalUnread));
                row.appendChild(badge);
            }

            const tools = element('div', 'thk-tree-tools');
            const addChildBtn = button('+', (e) => { e.stopPropagation(); openFolderModal(null, folder.id); }, 'thk-tree-tool-btn');
            addChildBtn.title = 'Thêm thư mục con';
            const editBtn = button('✎', (e) => { e.stopPropagation(); openFolderModal(folder); }, 'thk-tree-tool-btn');
            editBtn.title = t('edit');
            const delBtn = button('✕', (e) => {
                e.stopPropagation();
                const cur = getRoomTree();
                function removeById(list, id) {
                    const idx = list.findIndex(item => item.id === id);
                    if (idx >= 0) { list.splice(idx, 1); return true; }
                    for (const item of list) {
                        if (item.children && removeById(item.children, id)) return true;
                    }
                    return false;
                }
                removeById(cur, folder.id);
                saveRoomTree(cur);
                mountRoomTree(true);
            }, 'thk-tree-tool-btn');
            delBtn.title = t('delete');

            tools.append(addChildBtn, editBtn, delBtn);
            row.appendChild(tools);

            row.addEventListener('click', () => {
                folder.collapsed = !folder.collapsed;
                saveRoomTree(tree);
                mountRoomTree(true);
            });
            node.appendChild(row);

            if (!folder.collapsed) {
                const sublist = element('ul', 'thk-tree-sublist');
                (folder.children || []).forEach(child => renderFolder(child, sublist));
                (folder.rooms || []).forEach(rid => {
                    const roomInfo = roomsMap.get(String(rid)) || { id: rid, name: 'Room ' + rid, unread: 0 };
                    const roomRow = element('li', 'thk-tree-row' + (String(rid) === currentRoomId ? ' active' : ''));
                    roomRow.setAttribute('data-rid', String(rid));
                    const roomLabel = element('div', 'thk-tree-label');
                    roomLabel.append(element('span', '', '💬 '), element('span', '', roomInfo.name));
                    roomRow.appendChild(roomLabel);

                    if (roomInfo.unread > 0) {
                        roomRow.appendChild(element('span', 'thk-tree-badge', String(roomInfo.unread)));
                    }

                    roomRow.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (window.RM?.selectRoom) window.RM.selectRoom(rid);
                        else window.location.hash = '#!rid' + rid;
                    });
                    sublist.appendChild(roomRow);
                });
                node.appendChild(sublist);
            }

            container.appendChild(node);
        }

        const treeContainer = element('div', 'thk-tree-container');
        tree.forEach(f => renderFolder(f, treeContainer));
        panelNode.appendChild(treeContainer);
    }

    function syncToolbar() {
        syncCoreTheme();
        localize();
        mountRoomTree();
        const toolbar = document.getElementById('thk-toolbar-inline');
        if (!toolbar) return;
        toolbar.querySelector('#thkToolkit-emoji')?.remove();
        const leave = toolbar.querySelector('#thkBtnLeaveRequest');
        if (leave && leave.title !== t('leave')) leave.title = t('leave');
        const actions = [
            ['pr', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><line x1="6" y1="9" x2="6" y2="21"></line></svg>', insertPullRequest],
            ['files', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>', () => window.__thkFiles?.open()],
            ['settings', '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>', openSettings]
        ];
        actions.forEach(([key,iconSvg,action]) => {
            let node = toolbar.querySelector('#thkToolkit-' + key);
            if (!node) {
                node = button('', action, 'thk-icon-btn'); node.id = 'thkToolkit-' + key;
                node.innerHTML = iconSvg;
                node.addEventListener('mousedown', e => e.preventDefault()); toolbar.appendChild(node);
            }
            if (node.title !== t(key)) { node.title = t(key); node.setAttribute('aria-label', t(key)); }
        });
        shortcuts.forEach(([key,id]) => {
            const node = toolbar.querySelector('#' + id); if (!node) return;
            const hidden = !shortcutVisible(key);
            if (node.hidden !== hidden) node.hidden = hidden;
            if (node.style) {
                if (hidden && node.style.getPropertyValue('display') !== 'none') node.style.setProperty('display','none','important');
                else if (!hidden && node.style.getPropertyValue('display') === 'none') node.style.removeProperty('display');
            }
        });
    }
    function syncCoreTheme() {
        if (typeof window.getComputedStyle !== 'function') return;
        const chat = getEditor(); if (!chat) return;
        const style = window.getComputedStyle(chat);
        const root = document.documentElement.style;
        const set = (key,value) => { if (value && root.getPropertyValue(key) !== value) root.setProperty(key,value); };
        const painted = start => {
            for (let node=start; node; node=node.parentElement) {
                const color = window.getComputedStyle(node).backgroundColor;
                if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
            }
            return '';
        };
        set('--thk-text', style.color); set('--thk-font', style.fontFamily); set('--thk-surface', painted(chat));
        const nativeSend = document.querySelector('#_sendButton, #_chatSendButton, #CurrentSelectedRoom button[data-testid*="send"], #CurrentSelectedRoom button[aria-label="送信"]');
        if (nativeSend && !nativeSend.disabled) {
            const color = window.getComputedStyle(nativeSend).backgroundColor;
            if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') set('--thk-accent', color);
        }
        const channels = (style.color || '').match(/[\d.]+/g);
        const dark = channels && channels.slice(0,3).map(Number).reduce((a,b)=>a+b,0) > 500;
        const theme=dark?'dark':'light';
        if(document.documentElement.dataset?.thkTheme!==theme) {
            if (document.documentElement.dataset) document.documentElement.dataset.thkTheme=theme;
        }
        set('--thk-panel', dark ? '#24272a' : '#f5f6f7'); set('--thk-border', dark ? '#484c50' : '#dcdfe3');
        set('--thk-muted', dark ? '#b2b8bd' : '#687179'); set('--thk-code', dark ? '#202326' : '#f3f4f5');
        set('--thk-tint', dark ? '#203b33' : '#e8f5ef');
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
        if (document.documentElement?.classList?.remove) document.documentElement.classList.remove('thk-compact');
        syncToolbar();
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => syncToolbar()) : null;
        if (observer) observer.observe(document.body, {childList:true,subtree:true});
        if (typeof window.addEventListener === 'function') {
            window.addEventListener('hashchange', () => { closePanel?.(); syncToolbar(); });
            window.addEventListener('storage', event => { if (event.key?.startsWith('thk-toolkit.toolbar')) syncToolbar(); });
        }
        if (typeof setInterval === 'function') setInterval(syncToolbar, 1500);
    }
    window.__thkToolkit = {
        getRoom,
        getRoomMembers: getModernMembers,
        translate: translateLabel,
        resolveAvatarUrl,
        close: () => closePanel?.(),
        openSettings,
        insertPullRequest,
        panel,
        getLanguage,
        toolbarPreferences,
        getShortkeys,
        setShortkey,
        getAllRooms,
        autoGroupRooms,
        mountRoomTree,
        getRoomTree,
        saveRoomTree
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
