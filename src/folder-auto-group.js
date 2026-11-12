(function () {
    'use strict';
    const messages = {
        vi:{title:'Tự động gom theo prefix',parent:'Thư mục đích',root:'[Danh mục gốc]',hint:'Nhận tiền tố [HN], 【HN】, đường dẫn A / B / Tên nhóm hoặc A - Tên nhóm. Giữ các phòng hiện có trong danh mục.',enable:'Tự động thêm nhóm mới có cùng prefix',apply:'Áp dụng',preview:'nhóm phù hợp',paths:'nhánh thư mục',empty:'Chưa có nhóm nào có prefix phù hợp.',working:'Đang gom nhóm…',failed:'Chưa gom xong. Có thể thử lại; các danh mục đã tạo sẽ được dùng lại.',stale:'Danh mục hoặc tài khoản đã thay đổi. Hãy mở lại.'},
        en:{title:'Auto group by prefix',parent:'Destination folder',root:'[Root categories]',hint:'Recognizes [HN], 【HN】, A / B / Room and A - Room. Keeps existing category memberships.',enable:'Automatically add new groups with matching prefixes',apply:'Apply',preview:'matching groups',paths:'folder branches',empty:'No matching group prefixes.',working:'Grouping…',failed:'Grouping did not finish. Retry to reuse the categories already created.',stale:'The category or account changed. Reopen this dialog.'},
        ja:{title:'接頭辞で自動分類',parent:'保存先',root:'[ルートカテゴリ]',hint:'[HN]、【HN】、A / B / 名前、A - 名前に対応。既存のルームは保持します。',enable:'新しいグループも自動で分類する',apply:'適用',preview:'グループ',paths:'フォルダ',empty:'対象の接頭辞がありません。',working:'分類中…',failed:'分類を完了できませんでした。再試行すると既存のカテゴリを再利用します。',stale:'カテゴリまたはアカウントが変更されました。開き直してください。'}
    };
    const t = key => (messages[window.__thkToolkit?.getLanguage() || 'en'] || messages.en)[key];
    const account = () => { const id=window.CW?.application?.myId; return String(id?.getValue?.() ?? id?.value ?? id ?? 'default'); };
    const storageKey = () => 'thk-toolkit.nativeFolderAuto.' + account();
    const normalize = name => name.normalize('NFKC').trim().toLowerCase();
    function rules() { try { const data=JSON.parse(localStorage.getItem(storageKey()) || '{}'); return data && typeof data==='object' && !Array.isArray(data)?data:{}; } catch (_) { return {}; } }
    function writeRules(data) { localStorage.setItem(storageKey(), JSON.stringify(data)); }
    function prefix(name) {
        const parts=[]; let rest=String(name || '').trim(), match;
        while ((match=rest.match(/^(?:\[([^\]]+)\]|【([^】]+)】)\s*/))) { const part=(match[1] || match[2]).trim(); if(part)parts.push(part);rest=rest.slice(match[0].length); }
        const path=rest.split(/\s*\/\s*|\s+-\s+/).map(part=>part.trim()).filter(Boolean);
        if(path.length>1)parts.push(...path.slice(0,-1));
        return parts;
    }
    function plan(items) {
        const buckets=new Map(), grouped=new Set();
        for(const room of items) {
            if(room.type!=='group' || !room.id)continue;
            const parts=prefix(room.name);if(!parts.length)continue;
            const key=JSON.stringify(parts.map(normalize));
            if(!buckets.has(key))buckets.set(key,{parts,rooms:[]});
            const id=String(room.id),bucket=buckets.get(key);if(!bucket.rooms.includes(id))bucket.rooms.push(id);
            grouped.add(id);
        }
        return {buckets:[...buckets.values()],count:grouped.size};
    }
    function signature(items) { return JSON.stringify(items.filter(room=>room.type==='group').map(room=>[String(room.id),room.name]).sort((a,b)=>a[0].localeCompare(b[0]))); }
    function flatten(tree, parentId='', path='') { return tree.flatMap(node=>[{...node,parentId,path:path+node.name},...flatten(node.children,node.id,path+node.name+' / ')]); }
    let active=null, activeParent='', retryAfter=0;
    const pendingLinks=new Map();
    function apply(parentId='', progress=()=>{}) {
        if(active)return activeParent===parentId?active:active.then(()=>apply(parentId,progress));
        const owner=account(), folderAPI=window.__thkRoomFolders, items=window.__thkToolkit.getAllRooms(), preview=plan(items);
        const result={created:0,updated:0,groups:preview.count,signature:signature(items)};
        const work=(async()=>{
            writeRules(rules());
            const ensureCurrent=()=>{if(account()!==owner || parentId && !flatten(folderAPI.getTree()).some(node=>node.id===parentId))throw new Error(t('stale'));};
            ensureCurrent();
            for(const [index,bucket] of preview.buckets.entries()) {
                let parent=parentId;
                for(const [depth,name] of bucket.parts.entries()) {
                    ensureCurrent();
                    const list=flatten(folderAPI.getTree());
                    const key=owner+'|'+parent+'|'+normalize(name);
                    let target=list.find(node=>node.parentId===parent && normalize(node.name)===normalize(name));
                    const pending=pendingLinks.get(key);
                    if(!target && pending)target=list.find(node=>node.id===pending);
                    const last=depth===bucket.parts.length-1;
                    if(!target) {
                        const id=await folderAPI.saveCategory(name,last?bucket.rooms:[]);
                        pendingLinks.set(key,id);ensureCurrent();folderAPI.reparent(id,parent);pendingLinks.delete(key);
                        target=flatten(folderAPI.getTree()).find(node=>node.id===id);result.created++;
                    } else {
                        if(target.parentId!==parent){folderAPI.reparent(target.id,parent);pendingLinks.delete(key);}
                        if(last) {
                            const rooms=[...new Set([...target.rooms,...bucket.rooms])];
                            if(rooms.length!==target.rooms.length){await folderAPI.saveCategory(target.name,rooms,target.id);result.updated++;}
                        }
                    }
                    parent=target.id;
                }
                progress({done:index+1,total:preview.buckets.length,path:bucket.parts.join(' / ')});
            }
            folderAPI.mount();return result;
        })();
        active=work;activeParent=parentId;
        const clear=()=>{if(active===work){active=null;activeParent='';}};work.then(clear,clear);
        return work;
    }
    function configure(parentId,enabled,lastSignature='') {
        const data=rules();data[parentId || '$root']={enabled,signature:lastSignature};writeRules(data);
    }
    function check() {
        if(active || Date.now()<retryAfter || !window.__thkRoomFolders?.getTree().length)return null;
        const items=window.__thkToolkit.getAllRooms(), current=signature(items), owner=account();
        if(!items.some(room=>room.type==='group'))return null;
        for(const [key,rule] of Object.entries(rules())) {
            if(!rule.enabled || rule.signature===current)continue;
            const parent=key==='$root'?'':key;
            if(parent && !flatten(window.__thkRoomFolders.getTree()).some(node=>node.id===parent))continue;
            return apply(parent).then(result=>{if(account()===owner)configure(parent,true,result.signature);return result;}).catch(error=>{
                retryAfter=Date.now()+60000;
                if(account()===owner){try{const data=rules();data[key]={...rule,error:error?.message || t('failed')};writeRules(data);}catch(_){}}
                return {error:error?.message || t('failed')};
            });
        }
        return null;
    }
    function element(tag,className,content){const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;}
    function open(parentId='') {
        const view=window.__thkToolkit.panel(t('title')), owner=account();
        const label=element('label','thk-toolkit-label',t('parent')), select=element('select','thk-input-field');
        const root=element('option','',t('root'));root.value='';select.appendChild(root);
        flatten(window.__thkRoomFolders.getTree()).forEach(folder=>{const option=element('option','',folder.path);option.value=folder.id;select.appendChild(option);});
        select.value=parentId;label.appendChild(select);view.body.append(label,element('p','thk-leave-hint',t('hint')));
        const summary=element('p','thk-folder-directory-summary'), list=element('ul','thk-folder-auto-preview');
        view.body.append(summary,list);
        const enabledLabel=element('label','thk-toolkit-check'), enabled=element('input');enabled.type='checkbox';
        const update=()=>{
            list.replaceChildren();const preview=plan(window.__thkToolkit.getAllRooms());
            summary.textContent=preview.count+' '+t('preview')+' · '+preview.buckets.length+' '+t('paths');
            if(!preview.buckets.length)list.appendChild(element('li','',t('empty')));
            preview.buckets.forEach(bucket=>list.appendChild(element('li','',bucket.parts.join(' / ')+' ('+bucket.rooms.length+')')));
            enabled.checked=rules()[select.value || '$root']?.enabled ?? true;
        };
        select.addEventListener('change',update);update();
        enabledLabel.append(enabled,element('span','',t('enable')));view.body.appendChild(enabledLabel);
        const status=element('p','thk-settings-status');status.setAttribute('role','status');view.body.appendChild(status);
        const button=element('button','thk-btn-primary',t('apply'));button.type='button';
        button.addEventListener('click',async()=>{
            if(account()!==owner){status.textContent=t('stale');return;}
            button.disabled=true;status.textContent=t('working');
            try {
                const result=await apply(select.value,state=>{if(view.backdrop.isConnected)status.textContent=state.done+'/'+state.total+' · '+state.path;});
                if(account()!==owner)throw new Error(t('stale'));
                configure(select.value,enabled.checked,result.signature);view.close();
            } catch(error){status.textContent=(error?.message || t('failed'))+' '+t('failed');}
            finally{button.disabled=false;}
        });view.footer.prepend(button);
    }
    function mount() {
        const anchor=document.getElementById('_createChatRoomMenuButton') || document.querySelector('[data-testid="room-list-header_create-chat-room-menu"]');
        if(anchor?.parentElement) {
            let button=document.getElementById('thk-native-auto-group');
            if(!button){button=element('button','thk-native-folder-option thk-native-folder-global-auto','⚡');button.id='thk-native-auto-group';button.type='button';button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open();});}
            if(button.title!==t('title'))button.title=t('title');
            if(button.getAttribute('aria-label')!==t('title'))button.setAttribute('aria-label',t('title'));
            if(button.parentElement!==anchor.parentElement)anchor.parentElement.appendChild(button);
        }
        check();
    }
    window.__thkFolderAuto={prefix,plan,apply,configure,check,open,mount};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
