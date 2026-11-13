// Run with: node examples/toolkit-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/toolkit.js'), 'utf8');
new vm.Script(source);
const stored = new Map();
const window = { location: { hash: '#!rid7' }, CW: { application: {
    languageCode: { value: 'vi' },
    domainServiceContext: {
        roomService: { roomRepository: { entities: { 7: { name: {value:'Attendance infor_THKHN'}, members: [{userId:{value:'1'}}], relatedTeams: {value:[{identity:{value:'10'}}]} } } } },
        userService: { userRepository: { entities: {
            1: {name:{value:'Nguyễn An'},profile:{profileImage:{value:'/avatar/user.rsz.png'}}}, 2: {name:{value:'Tanaka'}}, 3: {name:{value:'Outside room'}}
        } } },
        teamService: {teamRepository:{entities:{10:{teamMembersEntity:{value:{teamMembers:[{identity:{value:'2'}}]}}}}}}
    }
} } };
const document = { readyState:'loading', documentElement:{lang:'vi'}, addEventListener() {}, querySelector() { return null; } };
const context = vm.createContext({ window, document, navigator:{language:'en'}, localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)}, Intl, URL, Map, Set, WeakMap, console });
const instrumented = source.replace('    window.__thkToolkit =', '    globalThis.testApi = { shortcutVisible, formatPullRequest, rememberPullRequestProject, getLanguage, translateLabel, resolveAvatarUrl, settings };\n    window.__thkToolkit =');
vm.runInContext(instrumented, context);
const api = context.testApi;
assert.equal(api.resolveAvatarUrl('/avatar/user.rsz.png'), 'https://appdata.chatwork.com/avatar/user.rsz.png');
assert.equal(api.resolveAvatarUrl({value:'/avatar/user.rsz.png'}), 'https://appdata.chatwork.com/avatar/user.rsz.png');
assert.equal(api.resolveAvatarUrl('https://appdata.chatwork.com/avatar/user.png'), 'https://appdata.chatwork.com/avatar/user.png');
assert.equal(api.resolveAvatarUrl('javascript:alert(1)'), '');
assert.equal(window.__thkToolkit.getRoomMembers()[0].avatar, 'https://appdata.chatwork.com/avatar/user.rsz.png');
assert.equal(window.__thkToolkit.getRoom().name, 'Attendance infor_THKHN');
assert.equal(window.__thkToolkit.getRoomMembers().map(member=>member.id).join(','), '1,2', 'Include related team members, exclude other contacts');
assert.equal(api.getLanguage(), 'vi'); api.settings.language='ja';
assert.equal(api.translateLabel('Nghỉ phép năm'), '有給休暇'); api.settings.language='en';
assert.equal(api.translateLabel('Nghỉ phép năm'), 'Paid leave'); api.settings.language='vi';
assert.equal(api.translateLabel('Nghỉ phép năm'), 'Nghỉ phép năm');
assert.ok(!source.includes('function rememberEmoji'), 'Recent emoji tracking removed');
assert.equal(api.formatPullRequest(' Project ', ' https://example.com/pull/1 ', ' Spec ', ' 30 phút '), '[toall]\n[info]\nProject name: Project\nPull Request: https://example.com/pull/1\nSpec: Spec\nThời gian review dự kiến: 30 phút\n[/info]\n');
assert.equal(api.formatPullRequest(), '[toall]\n[info]\nProject name: \nPull Request: \nSpec: \nThời gian review dự kiến: \n[/info]\n');
api.rememberPullRequestProject(api.formatPullRequest('New Project'));
assert.equal(JSON.parse(stored.get('thk-toolkit.prProject')),'New Project');
stored.set('thk-toolkit.toolbar',JSON.stringify({pr:true,leave:true,code:false}));
assert.equal(api.shortcutVisible('pr'),true,'Explicit PR setting overrides legacy room-name restrictions');
assert.equal(api.shortcutVisible('code'),false);
stored.set('thk-toolkit.toolbar.room.7',JSON.stringify({pr:false}));
assert.equal(api.shortcutVisible('pr'),false,'Room preference overrides global preference');
stored.set('thk-toolkit.toolbar.room.7',JSON.stringify({pr:true}));
window.CW.application.domainServiceContext.roomService.roomRepository.entities[7].name.value='Other room';
assert.equal(api.shortcutVisible('pr'),true);assert.equal(api.shortcutVisible('leave'),true);
window.CW.application.domainServiceContext.roomService.roomRepository.entities[7].name.value='Attendance infor_THKHN';
console.log('Toolkit language, membership and PR regression checks passed.');

// Exercise dialogs and toolbar actions with a small DOM adapter, without a live Chatwork session.
class UIEvent {
    constructor(type, options={}) { this.type=type; Object.assign(this, options); }
    preventDefault() { this.defaultPrevented=true; }
    stopPropagation() {}
    stopImmediatePropagation() {}
}
class ClassList {
    constructor(node) { this.node=node; }
    toggle(name, force) { const list=new Set(this.node.className.split(/\s+/).filter(Boolean)); const on=force??!list.has(name); if(on)list.add(name);else list.delete(name); this.node.className=[...list].join(' '); return on; }
    add(name) { this.toggle(name,true); } remove(name) { this.toggle(name,false); }
    contains(name) { return this.node.className.split(/\s+/).includes(name); }
}
class UIStyle {
    getPropertyValue(key) { return this[key] || ''; }
    setProperty(key, value) { this[key] = value; }
    removeProperty(key) { delete this[key]; }
}
let uiDocument;
class UINode {
    constructor(tag, text='') { this.tagName=tag.toUpperCase(); this.children=[]; this.parentNode=null; this.className=''; this.classList=new ClassList(this); this.attrs={}; this.listeners={}; this.value=''; this.nodeValue=text; this.hidden=false; this.disabled=false; this.style=new UIStyle(); this.dataset={}; }
    set textContent(value) { this.children=[]; this.nodeValue=''; if(String(value))this.appendChild(new UINode('#text',String(value))); }
    get textContent() { return this.tagName==='#TEXT'?this.nodeValue:this.children.map(node=>node.textContent).join(''); }
    get parentElement() { return this.parentNode; }
    get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this)+1] || null; }
    contains(node) { return this === node || this.children.some(child=>child.contains(node)); }
    get isConnected() { return this===uiDocument?.documentElement||!!this.parentNode?.isConnected; }
    replaceChildren(...nodes) { for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes); }
    appendChild(node) { node.remove(); this.children.push(node); node.parentNode=this; return node; }
    insertBefore(node, reference) { node.remove(); this.children.splice(this.children.indexOf(reference),0,node); node.parentNode=this; return node; }
    append(...nodes) { nodes.forEach(node=>this.appendChild(node)); }
    prepend(node) { node.remove(); this.children.unshift(node);node.parentNode=this; }
    replaceChildren(...nodes) { this.children.forEach(node=>node.parentNode=null);this.children=[];this.append(...nodes); }
    remove() { if(this.parentNode) {const list=this.parentNode.children;list.splice(list.indexOf(this),1);this.parentNode=null;} }
    setAttribute(key,value) { this.attrs[key]=String(value); }
    getAttribute(key) { return key==='title'?this.title||null:this.attrs[key]??null; }
    addEventListener(name,fn) { (this.listeners[name]??=[]).push(fn); }
    dispatchEvent(event) { event.target=this; (this.listeners[event.type]||[]).forEach(fn=>fn(event)); if(event.bubbles)uiDocument.listeners[event.type]?.forEach(fn=>fn(event)); }
    click() { if(!this.disabled)this.dispatchEvent(new UIEvent('click')); }
    focus() { uiDocument.activeElement=this; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
    matches(query) {return query.split(',').some(item=>{item=item.trim();if(item.startsWith('#'))return this.id===item.slice(1);if(item.startsWith('.'))return this.classList.contains(item.slice(1));const attr=item.match(/^\[([^=*]+)(\*)?(?:="([^"]*)")?\]$/);if(attr){const value=attr[1]==='class'?this.className:this.getAttribute(attr[1]);return attr[3]===undefined?value!==null:attr[2]?value?.includes(attr[3]):value===attr[3];}return this.tagName===item.toUpperCase();});}
    querySelectorAll(query) { const result=[]; for(const node of this.children){if(node.matches(query))result.push(node);result.push(...node.querySelectorAll(query));}return result; }
    querySelector(query) { return this.querySelectorAll(query)[0]||null; }
    closest(query) { return this.matches(query)?this:this.parentNode?.closest(query)||null; }
}
uiDocument = {
    readyState:'loading',listeners:{}, createElement:tag=>new UINode(tag),createTextNode:text=>new UINode('#text',text),
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);},
    querySelectorAll(query){return this.documentElement.querySelectorAll(query);},querySelector(query){return this.querySelectorAll(query)[0]||null;},
    getElementById(id){return this.querySelector('#'+id);},execCommand(){return false;},
    createTreeWalker(root){const nodes=[];function visit(node){if(node.tagName==='#TEXT')nodes.push(node);node.children.forEach(visit);}visit(root);let index=0;return{nextNode:()=>nodes[index++]||null};}
};
uiDocument.documentElement=new UINode('html');uiDocument.documentElement.lang='vi';
uiDocument.head=new UINode('head');uiDocument.body=new UINode('body');uiDocument.documentElement.append(uiDocument.head,uiDocument.body);
const toolbar=new UINode('li');toolbar.id='thk-toolbar-inline';
const leave=new UINode('button');leave.id='thkBtnLeaveRequest';toolbar.append(leave);
const editor=new UINode('textarea');editor.id='_chatText';editor.value='Hello ';editor.setSelectionRange(6,6);
uiDocument.body.append(toolbar,editor);editor.focus();
const uiStore=new Map();
let transferBlob, transferDownloads=[], transferImports=[], mergeEnabled=true, mergeSettingsError=false, mergeChanges=[], roomMounts=0, sidebarScrolling=false, uiObserver;
const uiTimers=[];
const transferSnapshot={format:'thk-chat.folder-tree',version:1,accountId:'7',folders:[{id:'a',parentId:''}]};
const uiWindow={...window,addEventListener(){},removeEventListener(){},
    __thk_startDownload:(url,filename)=>transferDownloads.push({url,filename}),
    __thkRoomFolders:{mount(){roomMounts++;},isScrolling:()=>sidebarScrolling,isMergeEnabled:()=>mergeEnabled,setMergeEnabled(enabled){if(mergeSettingsError)throw new Error(`Storage full`);mergeEnabled=enabled;mergeChanges.push(enabled);},getTree:()=>[],exportTree:()=>transferSnapshot,
        previewImport:()=>({count:1,changes:1,skipped:0}),importTree:data=>{transferImports.push(data);return {count:1,changes:1,skipped:0};}}
};
class TransferURL extends URL {
    static createObjectURL(blob){transferBlob=blob;return 'blob:folder-tree';}
    static revokeObjectURL(){}
}
const uiContext=vm.createContext({window:uiWindow,document:uiDocument,navigator:{language:'vi'},localStorage:{getItem:key=>uiStore.get(key)??null,setItem:(key,value)=>uiStore.set(key,value)},Intl,URL:TransferURL,Blob,Event:UIEvent,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{constructor(callback){uiObserver=callback;}observe(){}},setInterval(){},setTimeout(callback,delay){uiTimers.push({callback,delay});return uiTimers.length;},console});
vm.runInContext(source,uiContext);uiDocument.listeners.DOMContentLoaded.forEach(fn=>fn());
assert.equal(toolbar.children.length,4,'All three Toolkit actions share existing toolbar');
assert.equal(leave.hidden,false,'Leave button appears in attendance room');
assert.equal(uiDocument.getElementById('thkToolkit-pr').hidden,true,'PR button hidden outside review room');
uiWindow.CW.application.domainServiceContext.roomService.roomRepository.entities[7].name.value='【HN】Source Code Review';
// Re-run toolbar sync through settings action after changing room.
uiDocument.getElementById('thkToolkit-settings').click();
let dialog=uiDocument.getElementById('thk-toolkit-panel');
let language=dialog.querySelector('select');language.value='vi';language.dispatchEvent(new UIEvent('change'));
assert.equal(leave.hidden,true);assert.equal(uiDocument.getElementById('thkToolkit-pr').hidden,false);
dialog=uiDocument.getElementById('thk-toolkit-panel');
assert.equal(dialog.querySelectorAll('select').length,2,'Language select and shortcut scope select');
const scopeSelect = dialog.querySelectorAll('select')[1];
assert.equal(scopeSelect.value, 'room', 'Default scope is current group');
const firstShortcut=dialog.querySelector('input');firstShortcut.checked=false;firstShortcut.dispatchEvent(new UIEvent('change'));
assert.equal(JSON.parse(uiStore.get('thk-toolkit.toolbar.room.7')).info,false);
assert.equal(uiStore.has('thk-toolkit.toolbar'),false,'Changing group settings never writes a global configuration');
assert.equal(dialog.querySelector('.thk-shortcut-grid').querySelectorAll('input').length,8);
assert.equal(dialog.querySelectorAll('input').filter(input=>input.type==='file').length,1,'Settings include a folder tree import control');
assert.equal(uiDocument.getElementById('thkToolkit-emoji'),null);
assert.equal(uiWindow.__thkToolkit.toolbarPreferences('7').info,false);
assert.equal(uiWindow.__thkToolkit.toolbarPreferences('8').info,undefined,'Group settings do not apply to another group');
scopeSelect.value = 'all'; scopeSelect.dispatchEvent(new UIEvent('change'));
const allShortcut = dialog.querySelector('input'); allShortcut.checked = false; allShortcut.dispatchEvent(new UIEvent('change'));
assert.equal(JSON.parse(uiStore.get('thk-toolkit.toolbar')).info, false, 'Changing all-groups settings writes global configuration');
assert.equal(uiWindow.__thkToolkit.toolbarPreferences('8').info,false,'Global settings now apply to other groups');
const mergeToggle=dialog.querySelector('#thkMergeUnclassifiedChats');assert.equal(mergeToggle.checked,true);assert.equal(mergeToggle.disabled,false);
mergeToggle.checked=false;mergeToggle.dispatchEvent(new UIEvent('change'));assert.equal(mergeEnabled,false);
uiWindow.__thkToolkit.openSettings();dialog=uiDocument.getElementById('thk-toolkit-panel');
const restoredToggle=dialog.querySelector('#thkMergeUnclassifiedChats');assert.equal(restoredToggle.checked,false,'Reopening settings restores the saved preference');
mergeSettingsError=true;restoredToggle.checked=true;restoredToggle.dispatchEvent(new UIEvent('change'));
assert.equal(restoredToggle.checked,false,'A failed save restores the actual preference');
mergeSettingsError=false;restoredToggle.checked=true;restoredToggle.dispatchEvent(new UIEvent('change'));assert.equal(mergeEnabled,true);
const mountsBefore=roomMounts;uiObserver();uiObserver();
assert.equal(uiTimers.filter(timer=>timer.delay===80).length,1,'Toolkit mutation callbacks are batched');
sidebarScrolling=true;uiTimers.shift().callback();assert.equal(roomMounts,mountsBefore);
sidebarScrolling=false;uiTimers.shift().callback();assert.equal(roomMounts,mountsBefore+1,'Toolkit refresh resumes after sidebar scrolling');
uiDocument.getElementById('thkToolkit-pr').click();
assert.equal(uiDocument.getElementById('thk-toolkit-panel'),null,'PR inserts directly without a popup');
assert.ok(editor.value.includes('[toall]\n[info]\nProject name: \nPull Request: \nSpec: \nThời gian review dự kiến: \n[/info]\n'));
assert.equal(editor.selectionStart,editor.value.indexOf('Project name: ')+'Project name: '.length,'Place cursor in first blank field');
editor.value=editor.value.replace('Project name: \n','Project name: Chatwork\n');
editor.dispatchEvent(new UIEvent('input',{bubbles:true}));
assert.equal(JSON.parse(uiStore.get('thk-toolkit.prProject')),'Chatwork','Remember project edited directly in chat');
editor.setSelectionRange(editor.value.length,editor.value.length);

uiDocument.getElementById('thkToolkit-pr').click();
assert.ok(editor.value.includes('Project name: Chatwork\nPull Request: '));
assert.equal(editor.selectionStart,editor.value.lastIndexOf('Pull Request: ')+'Pull Request: '.length,'Skip remembered project field');
assert.equal(uiDocument.getElementById('thk-toolkit-panel'),null);
assert.equal(toolbar.children.length,4,'Repeated setup does not duplicate buttons');
assert.equal(uiDocument.getElementById('thkToolkit-compact'),null,'Compact mode removed');

// Custom shortkey configuration tests
const shortkeys = uiWindow.__thkToolkit.getShortkeys();
assert.equal(shortkeys.info, 'Ctrl+I');
assert.equal(shortkeys.preview, 'Ctrl+Shift+P');
uiWindow.__thkToolkit.setShortkey('info', 'Ctrl+Alt+I');
assert.equal(uiWindow.__thkToolkit.getShortkeys().info, 'Ctrl+Alt+I');
assert.equal(JSON.parse(uiStore.get('thk-toolkit.shortkeys')).info, 'Ctrl+Alt+I');

let codeShortcutCalls = 0;
const codeShortcutButton = new UINode('button'); codeShortcutButton.id = 'thkBtnCode';
codeShortcutButton.addEventListener('click', () => codeShortcutCalls++); toolbar.appendChild(codeShortcutButton);
const codeKeyEvent = new UIEvent('keydown', {key:'k',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false});
assert.equal(uiWindow.__thk_matchCustomShortkey(codeKeyEvent), true);
assert.equal(uiWindow.__thk_matchCustomShortkey(codeKeyEvent), true);
assert.equal(codeShortcutCalls, 1, 'Window and document listeners handle one key event exactly once');
const composingKey = new UIEvent('keydown', {key:'k',ctrlKey:true,metaKey:false,shiftKey:false,altKey:false,isComposing:true});
assert.equal(uiWindow.__thk_matchCustomShortkey(composingKey), false);
assert.equal(codeShortcutCalls, 1, 'IME composition does not trigger formatting');
codeShortcutButton.remove();

assert.ok(uiWindow.__thkToolkit.getAllRooms().length > 0);
assert.equal(uiWindow.__thkToolkit.getRoomTree().length, 0, 'No standalone room tree is fabricated without native categories');
(async()=>{
    uiWindow.__thkToolkit.openSettings();
    const section=uiDocument.getElementById('thk-toolkit-panel').querySelector('.thk-folder-transfer');
    const [exportButton,importButton,applyButton]=section.querySelectorAll('button');
    const input=section.querySelector('input');
    assert.equal(exportButton.disabled,false);assert.equal(importButton.disabled,false);
    exportButton.click();
    assert.equal(transferDownloads.length,1);assert.ok(transferDownloads[0].filename.endsWith('.json'));
    assert.deepEqual(JSON.parse(await transferBlob.text()),transferSnapshot,'Export downloads a portable JSON file');
    input.files=[{size:100,text:async()=>JSON.stringify(transferSnapshot)}];
    await input.listeners.change[0]();
    assert.equal(applyButton.hidden,false,'Valid imports show an apply action after preview');
    assert.equal(transferImports.length,0,'Selecting a file does not apply it immediately');
    applyButton.click();assert.equal(transferImports.length,1);assert.equal(applyButton.hidden,true);
    assert.equal(JSON.stringify(transferImports[0]),JSON.stringify(transferSnapshot));
    input.files=[{size:2_000_000,text:async()=>assert.fail('Oversized files must not be read')}];
    await input.listeners.change[0]();assert.equal(applyButton.hidden,true);assert.equal(transferImports.length,1);
    input.files=[{size:20,text:async()=>'{invalid json'}];
    await input.listeners.change[0]();assert.equal(applyButton.hidden,true);assert.equal(transferImports.length,1);
    let resolveRead;input.files=[{size:100,text:()=>new Promise(resolve=>{resolveRead=resolve;})}];
    const pendingRead=input.listeners.change[0]();uiWindow.__thkToolkit.close();resolveRead(JSON.stringify(transferSnapshot));
    await pendingRead;assert.equal(applyButton.hidden,true,'Closing settings cancels a pending file preview');
    console.log('Toolkit dialogs, toolbar, shortcuts and folder transfer UI checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
