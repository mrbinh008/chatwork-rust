(function () {
    'use strict';
    const managed = new Map();
    const containers = new Set();
    const labels = {
        vi: {child:'+ Thư mục con', parent:'Thư mục cha', root:'[Thư mục gốc]', name:'Tên thư mục', rooms:'Chọn phòng', search:'Tìm phòng…', save:'Lưu', local:'Quan hệ thư mục cha/con được lưu trên thiết bị này.', failed:'Không lưu được thay đổi. Vui lòng thử lại.', unavailable:'Chưa đọc được chức năng danh mục của Chatwork.', stale:'Thư mục đã thay đổi. Hãy mở lại và chọn thư mục cha.'},
        en: {child:'+ Subfolder', parent:'Parent folder', root:'[Root folder]', name:'Folder name', rooms:'Select rooms', search:'Find rooms…', save:'Save', local:'Folder nesting is saved on this device.', failed:'Could not save changes. Please try again.', unavailable:'Chatwork category services are not available.', stale:'Folders have changed. Reopen and choose a parent.'},
        ja: {child:'+ 子フォルダ', parent:'親フォルダ', root:'[ルートフォルダ]', name:'フォルダ名', rooms:'ルームを選択', search:'ルームを検索…', save:'保存', local:'フォルダ階層はこの端末に保存されます。', failed:'保存できませんでした。もう一度お試しください。', unavailable:'Chatworkのカテゴリを読み込めません。', stale:'フォルダが変更されました。親フォルダを選択し直してください。'}
    };
    const text = key => (labels[window.__thkToolkit?.getLanguage() || 'en'] || labels.en)[key];
    Object.assign(labels.vi, {all:'Tất cả',group:'Nhóm',direct:'Người dùng',mychat:'Chat của tôi',reload:'Tải lại',selectAll:'Chọn các mục đang lọc',clear:'Bỏ chọn',loading:'Đang cập nhật danh sách…',empty:'Không có mục phù hợp.',pending:'Chưa có phòng chat — mở cuộc trò chuyện trước khi thêm vào danh mục.',cached:'Chưa tải lại được; đang hiển thị dữ liệu hiện có.',selected:'đã chọn',items:'mục',auto:'Tự động gom theo prefix'});
    Object.assign(labels.en, {all:'All',group:'Groups',direct:'People',mychat:'My Chat',reload:'Refresh',selectAll:'Select filtered items',clear:'Clear selection',loading:'Refreshing directory…',empty:'No matching items.',pending:'No chat yet — open a conversation before adding it to a category.',cached:'Refresh failed; showing available data.',selected:'selected',items:'items',auto:'Auto group by prefix'});
    Object.assign(labels.ja, {all:'すべて',group:'グループ',direct:'ユーザー',mychat:'マイチャット',reload:'再読み込み',selectAll:'絞り込みを選択',clear:'選択解除',loading:'一覧を更新中…',empty:'該当する項目はありません。',pending:'チャットを開始してからカテゴリに追加してください。',cached:'再読み込みできません。保存済みの一覧を表示しています。',selected:'選択',items:'件',auto:'接頭辞で自動分類'});
    const value = object => object?.getValue?.() ?? object?.value ?? object;
    function services() {
        const app = window.CW?.application;
        return {categories:app?.domainServiceContext?.customCategoryService, api:app?.applicationAPIServiceContext?.categoryAPIService, filters:app?.applicationServiceContext?.roomListFilterService};
    }
    function categories() {
        try {
            return (services().categories?.getSortedCategories() || []).map(category => ({
                id:String(value(category.identity)), name:String(category.getName?.() ?? value(category.name) ?? ''),
                rooms:(category.getRoomIds?.() || category.roomIds || []).map(id => String(value(id)))
            }));
        } catch (_) { return []; }
    }
    function storageKey() {
        return 'thk-toolkit.nativeFolderParents.' + String(value(window.CW?.application?.myId) ?? 'default');
    }
    function readParents() {
        try { const result = JSON.parse(localStorage.getItem(storageKey()) || '{}'); return result && typeof result === 'object' && !Array.isArray(result) ? result : {}; }
        catch (_) { return {}; }
    }
    function writeParents(parents) { localStorage.setItem(storageKey(), JSON.stringify(parents)); }
    function buildTree(list, parents) {
        const nodes = new Map(list.map(category => [category.id, {...category, parentId:'', children:[]}]));
        for (const node of nodes.values()) {
            const parent = String(parents[node.id] || '');
            const seen = new Set([node.id]); let next = parent; let valid = true;
            while (next && nodes.has(next)) {
                if (seen.has(next)) { valid = false; break; }
                seen.add(next); next = String(parents[next] || '');
            }
            if (valid && nodes.has(parent)) node.parentId = parent;
        }
        const roots = [];
        for (const node of nodes.values()) {
            if (node.parentId) nodes.get(node.parentId).children.push(node); else roots.push(node);
        }
        return roots;
    }
    function getTree() { return buildTree(categories(), readParents()); }
    function flatten(tree, depth = 0, prefix = '') {
        return tree.flatMap(node => [{...node, depth, path:prefix + node.name}, ...flatten(node.children, depth + 1, prefix + node.name + ' / ')]);
    }
    function validParent(list, id, parent) {
        if (!parent) return true;
        const map = new Map(flatten(buildTree(list, readParents())).map(node => [node.id, node]));
        const seen = new Set([id]); let next = parent;
        while (next) {
            if (!map.has(next) || seen.has(next)) return false;
            seen.add(next); next = map.get(next).parentId;
        }
        return true;
    }
    function reparent(id, parent) {
        const list = categories();
        if (!list.some(category => category.id === id) || !validParent(list, id, parent)) throw new Error(text('stale'));
        const parents = readParents();
        if (parent) parents[id] = parent; else delete parents[id];
        writeParents(parents);
    }
    async function saveCategory(name, rooms, existingId = '') {
        const application = window.CW?.application, owner = storageKey();
        const {api, filters} = services();
        if (!api?.add || !api?.update || !filters?.refreshCategory) throw new Error(text('unavailable'));
        // Refresh with the complete current category map: the native refresh method
        // overwrites its repository, so a partial map would remove other categories.
        let id = existingId, record;
        if (id) record = await api.update(id, name, rooms);
        else { id = String(await api.add(name, rooms)); record = {name, list:rooms}; }
        if (window.CW?.application !== application || storageKey() !== owner) throw new Error(text('stale'));
        if (!id || id === 'undefined' || !record || !Array.isArray(record.list)) throw new Error(text('failed'));
        const all = Object.fromEntries(categories().map(category => [category.id, {name:category.name, list:category.rooms}]));
        all[id] = record;
        filters.refreshCategory(all);
        return id;
    }
    function node(tag, className, content) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (content !== undefined) element.textContent = content;
        return element;
    }
    function reveal(parent) {
        const map = new Map(flatten(getTree()).map(folder => [folder.id, folder]));
        const seen = new Set();
        while (parent && !seen.has(parent)) {
            seen.add(parent);
            for (const [header, state] of managed) {
                if (state.id === parent && header.getAttribute('aria-expanded') === 'false') header.click();
            }
            parent = map.get(parent)?.parentId;
        }
    }
    function openEditor(id, createChild = false) {
        const list = flatten(getTree());
        const folder = list.find(folder => folder.id === id);
        if (!folder) return;
        const view = window.__thkToolkit?.panel(text(createChild ? 'child' : 'parent') + ': ' + folder.name);
        if (!view) return;
        const owner = storageKey();
        let createdId = '';
        const name = createChild ? node('input', 'thk-input-field') : null;
        if (name) { const label = node('label', 'thk-toolkit-label', text('name')); label.appendChild(name); view.body.appendChild(label); }
        const parentLabel = node('label', 'thk-toolkit-label', text('parent'));
        const parentSelect = node('select', 'thk-input-field');
        const rootOption = node('option', '', text('root')); rootOption.value = ''; parentSelect.appendChild(rootOption);
        list.filter(candidate => createChild || validParent(categories(), id, candidate.id)).forEach(candidate => {
            const option = node('option', '', candidate.path); option.value = candidate.id; parentSelect.appendChild(option);
        });
        parentSelect.value = createChild ? id : folder.parentId;
        parentLabel.appendChild(parentSelect); view.body.appendChild(parentLabel);
        const selectedRooms = new Set();
        if (createChild) {
            let items = window.__thkToolkit.getRoomDirectory?.() || window.__thkToolkit.getAllRooms().map(room => ({...room,key:'room:' + room.id,available:true}));
            const controls = node('div', 'thk-folder-directory-controls');
            const filter = node('select', 'thk-input-field'); filter.setAttribute('aria-label', text('rooms'));
            for (const key of ['all','group','direct','mychat']) { const option = node('option', '', text(key)); option.value = key; filter.appendChild(option); }
            filter.value = 'all'; controls.appendChild(filter);
            const reload = node('button', 'thk-chip-btn', text('reload')); reload.type = 'button'; controls.appendChild(reload);
            view.body.appendChild(controls);
            const search = node('input', 'thk-input-field'); search.placeholder = text('search');
            search.setAttribute('aria-label', text('search')); view.body.appendChild(search);
            const summary = node('p', 'thk-folder-directory-summary'); summary.setAttribute('role', 'status'); view.body.appendChild(summary);
            const selection = node('div', 'thk-folder-directory-selection');
            const selectAll = node('button', 'thk-chip-btn', text('selectAll')), clear = node('button', 'thk-chip-btn', text('clear'));
            selectAll.type = clear.type = 'button'; selection.append(selectAll, clear); view.body.appendChild(selection);
            const roomBox = node('div', 'thk-native-folder-room-choices'); view.body.appendChild(roomBox);
            const normalize = name => String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
            const filtered = () => items.filter(room => (filter.value === 'all' || room.type === filter.value) && normalize(room.name).includes(normalize(search.value)));
            let refreshing = false, warning = '';
            const updateSummary = () => {
                summary.textContent = (refreshing ? text('loading') + ' ' : warning ? text('cached') + ' ' : '')
                    + filtered().length + '/' + items.length + ' ' + text('items') + ' · ' + selectedRooms.size + ' ' + text('selected');
            };
            const renderRooms = () => {
                roomBox.replaceChildren();
                const visible = filtered();
                if (!visible.length) roomBox.appendChild(node('p', 'thk-leave-hint', text('empty')));
                visible.forEach(room => {
                    const label = node('label', 'thk-folder-room-choice');
                    label.setAttribute('data-room-key', room.key || 'room:' + room.id);
                    const check = node('input'); check.type = 'checkbox'; check.checked = selectedRooms.has(room.id); check.disabled = room.available === false;
                    check.setAttribute('aria-label', room.name);
                    check.addEventListener('change', () => { if (check.checked) selectedRooms.add(room.id); else selectedRooms.delete(room.id); updateSummary(); });
                    const detail = node('span', 'thk-folder-room-detail');
                    detail.append(node('span', 'thk-folder-room-name', room.name), node('span', 'thk-folder-room-kind', room.available === false ? text('pending') : text(room.type || 'group')));
                    label.append(check, detail); roomBox.appendChild(label);
                });
                updateSummary();
            };
            const refresh = async force => {
                if (!window.__thkToolkit.loadRoomDirectory) return;
                refreshing = true; reload.disabled = true; updateSummary();
                try {
                    const result = await window.__thkToolkit.loadRoomDirectory(force);
                    if (!view.backdrop.isConnected) return;
                    if (owner !== storageKey()) { view.close(); return; }
                    items = result.items; warning = result.error;
                } catch (error) { warning = error?.message || text('failed'); }
                finally { refreshing = false; reload.disabled = false; if (view.backdrop.isConnected) renderRooms(); }
            };
            selectAll.addEventListener('click', () => { filtered().filter(room => room.available !== false && room.id).forEach(room => selectedRooms.add(room.id)); renderRooms(); });
            clear.addEventListener('click', () => { selectedRooms.clear(); renderRooms(); });
            filter.addEventListener('change', renderRooms); search.addEventListener('input', renderRooms);
            reload.addEventListener('click', () => refresh(true)); renderRooms(); refresh(false);
        }
        view.body.appendChild(node('p', 'thk-leave-hint', text('local')));
        const status = node('p', 'thk-settings-status'); status.setAttribute('role', 'status'); view.body.appendChild(status);
        const save = node('button', 'thk-btn-primary', text('save')); save.type = 'button';
        save.addEventListener('click', async () => {
            if (owner !== storageKey()) { status.textContent = text('stale'); return; }
            const parent = parentSelect.value;
            if (name && !name.value.trim()) { name.focus(); return; }
            if (parent && !categories().some(category => category.id === parent)) { status.textContent = text('stale'); return; }
            save.disabled = true;
            try {
                // Check local persistence before making a server-side change.
                writeParents(readParents());
                if (createChild) createdId = await saveCategory(name.value.trim(), [...selectedRooms], createdId);
                reparent(createChild ? createdId : id, parent);
                mount(); reveal(parent); view.close();
            } catch (error) { status.textContent = error?.message || text('failed'); }
            finally { save.disabled = false; }
        });
        view.footer.prepend(save); (name || parentSelect).focus();
    }
    function headerCategoryId(header, list) {
        const explicit = header.getAttribute('data-category-id');
        if (explicit && list.some(category => category.id === explicit)) return explicit;
        // Read the native component's category identity without changing React state.
        let fiber = header[Object.keys(header).find(key => key.startsWith('__reactFiber$'))];
        for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
            const id = fiber.memoizedProps?.category?.id;
            if (id !== undefined && list.some(category => category.id === String(id))) return String(id);
        }
        const labels = [...header.querySelectorAll('div, span')].filter(element => !element.closest('.thk-native-folder-tools'));
        return list.find(category => labels.some(label => label.textContent.trim() === category.name))?.id || '';
    }
    function clearState(header, state) {
        state.tools.remove(); header.classList.remove('thk-native-folder-heading');
        header.removeAttribute('data-thk-native-folder-id'); header.removeAttribute('data-thk-folder-hidden');
        header.style.removeProperty('--thk-folder-depth'); header.style.order = state.order;
        if (state.rooms) {
            state.rooms.classList.remove('thk-native-folder-rooms'); state.rooms.removeAttribute('data-thk-folder-hidden');
            state.rooms.style.removeProperty('--thk-folder-depth'); state.rooms.style.order = state.roomsOrder;
        }
    }
    function mount() {
        // Remove the former standalone widget, including its layout overrides.
        document.getElementById('thk-room-tree-panel')?.remove(); document.getElementById('thk-room-tree-actions')?.remove();
        for (const className of ['thk-room-tree-host', 'thk-room-list-content', 'thk-room-list-controls', 'thk-room-list-control-slot', 'thk-room-sidebar-host']) {
            document.querySelectorAll('.' + className).forEach(element => element.classList.remove(className));
        }
        const host = document.querySelector('#_roomListArea.roomListWithSwitch, #roomListWithSwitch, .roomListWithSwitch, [class*="roomListWithSwitch"]');
        const list = categories(), layout = flatten(buildTree(list, readParents()));
        const native = new Map();
        host?.querySelectorAll('[role="button"][aria-expanded]').forEach(header => {
            const id = headerCategoryId(header, list); if (id) native.set(id, header);
        });
        const active = new Set(), activeContainers = new Set();
        for (const [index, folder] of layout.entries()) {
            const header = native.get(folder.id); if (!header) continue;
            active.add(header); activeContainers.add(header.parentElement);
            let state = managed.get(header);
            if (state && state.id !== folder.id) { clearState(header, state); managed.delete(header); state = null; }
            if (!state) {
                const tools = node('span', 'thk-native-folder-tools'); tools.setAttribute('role', 'group');
                tools.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
                tools.addEventListener('keydown', event => event.stopPropagation());
                for (const [content, mode] of [['+', 'child'], ['↳', 'parent'], ['⚡', 'auto']]) {
                    const control = node('button', 'thk-native-folder-option', content); control.type = 'button';
                    control.setAttribute('data-thk-folder-action', mode);
                    control.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); if (mode === 'auto') window.__thkFolderAuto?.open(folder.id); else openEditor(folder.id, mode === 'child'); });
                    tools.appendChild(control);
                }
                state = {id:folder.id, tools, order:header.style.order || '', rooms:null, roomsOrder:''}; managed.set(header, state);
            }
            if (state.tools.parentElement !== header) header.appendChild(state.tools);
            [...state.tools.children].forEach((control, position) => {
                const label = text(position === 0 ? 'child' : position === 1 ? 'parent' : 'auto');
                if (control.title !== label) control.title = label;
                if (control.getAttribute('aria-label') !== label) control.setAttribute('aria-label', label);
                control.disabled = position === 0 && (!services().api?.add || !services().filters?.refreshCategory) || position === 2 && !window.__thkFolderAuto;
            });
            let hidden = false, parent = folder.parentId; const seen = new Set();
            while (parent && !seen.has(parent)) {
                seen.add(parent);
                if (native.get(parent)?.getAttribute('aria-expanded') === 'false') hidden = true;
                parent = layout.find(candidate => candidate.id === parent)?.parentId;
            }
            header.classList.add('thk-native-folder-heading'); header.setAttribute('data-thk-native-folder-id', folder.id);
            header.setAttribute('data-thk-folder-hidden', String(hidden)); header.style.setProperty('--thk-folder-depth', String(folder.depth));
            header.style.order = String(index * 2);
            const rooms = header.nextElementSibling?.tagName === 'UL' ? header.nextElementSibling : null;
            if (state.rooms !== rooms) {
                if (state.rooms) { state.rooms.classList.remove('thk-native-folder-rooms'); state.rooms.removeAttribute('data-thk-folder-hidden'); state.rooms.style.order = state.roomsOrder; state.rooms.style.removeProperty('--thk-folder-depth'); }
                state.rooms = rooms; state.roomsOrder = rooms?.style.order || '';
            }
            if (rooms) {
                rooms.classList.add('thk-native-folder-rooms'); rooms.setAttribute('data-thk-folder-hidden', String(hidden));
                rooms.style.setProperty('--thk-folder-depth', String(folder.depth)); rooms.style.order = String(index * 2 + 1);
            }
        }
        for (const [header, state] of managed) if (!active.has(header)) { clearState(header, state); managed.delete(header); }
        for (const container of containers) if (!activeContainers.has(container)) { container.classList.remove('thk-native-folder-list'); containers.delete(container); }
        for (const container of activeContainers) { container.classList.add('thk-native-folder-list'); containers.add(container); }
        window.__thkFolderAuto?.mount();
    }
    window.__thkRoomFolders = {mount, getTree, openEditor, reparent, saveCategory, buildTree};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
