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
    stopImmediatePropagation() {}
}
class ClassList {
    constructor(node) { this.node=node; }
    toggle(name, force) { const list=new Set(this.node.className.split(/\s+/).filter(Boolean)); const on=force??!list.has(name); if(on)list.add(name);else list.delete(name); this.node.className=[...list].join(' '); return on; }
    add(name) { this.toggle(name,true); } remove(name) { this.toggle(name,false); }
    contains(name) { return this.node.className.split(/\s+/).includes(name); }
}
let uiDocument;
class UINode {
    constructor(tag, text='') { this.tagName=tag.toUpperCase(); this.children=[]; this.parentNode=null; this.className=''; this.classList=new ClassList(this); this.attrs={}; this.listeners={}; this.value=''; this.nodeValue=text; this.hidden=false; this.disabled=false; }
    set textContent(value) { this.children=[]; this.nodeValue=''; if(String(value))this.appendChild(new UINode('#text',String(value))); }
    get textContent() { return this.tagName==='#TEXT'?this.nodeValue:this.children.map(node=>node.textContent).join(''); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this===uiDocument?.documentElement||!!this.parentNode?.isConnected; }
    replaceChildren(...nodes) { for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes); }
    appendChild(node) { node.remove(); this.children.push(node); node.parentNode=this; return node; }
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
    matches(query) {return query.split(',').some(item=>{item=item.trim();if(item.startsWith('#'))return this.id===item.slice(1);if(item.startsWith('.'))return this.classList.contains(item.slice(1));if(item.startsWith('['))return this.getAttribute(item.slice(1,-1))!==null;return this.tagName===item.toUpperCase();});}
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
const uiWindow={...window,addEventListener(){},removeEventListener(){}};
const uiContext=vm.createContext({window:uiWindow,document:uiDocument,navigator:{language:'vi'},localStorage:{getItem:key=>uiStore.get(key)??null,setItem:(key,value)=>uiStore.set(key,value)},Intl,URL,Event:UIEvent,NodeFilter:{SHOW_TEXT:4},MutationObserver:class{observe(){}},setInterval(){},setTimeout(){},console});
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
assert.equal(dialog.querySelectorAll('select').length,1,'Only language select remains; shortcut scope is the current group');
const firstShortcut=dialog.querySelector('input');firstShortcut.checked=false;firstShortcut.dispatchEvent(new UIEvent('change'));
assert.equal(JSON.parse(uiStore.get('thk-toolkit.toolbar.room.7')).info,false);
assert.equal(uiStore.has('thk-toolkit.toolbar'),false,'Changing group settings never writes a global configuration');
assert.equal(dialog.querySelectorAll('input').length,8);
assert.equal(uiDocument.getElementById('thkToolkit-emoji'),null);
assert.equal(uiWindow.__thkToolkit.toolbarPreferences('7').info,false);
assert.equal(uiWindow.__thkToolkit.toolbarPreferences('8').info,undefined,'Group settings do not apply to another group');
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
console.log('Toolkit dialog, toolbar visibility and PR insertion checks passed.');
