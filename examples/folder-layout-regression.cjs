// Run with: node examples/folder-layout-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
let domWrites=0, layoutReads=0, clock=0;
const frames=[],timers=[];
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.events = {};
        let order='';this.style={get order(){return order;},set order(value){domWrites++;order=value;},setProperty(key,value){domWrites++;this[key]=value;},removeProperty(key){domWrites++;delete this[key];}};
        const classes = new Set(); this.classList = {add:name=>{domWrites++;classes.add(name);},remove:name=>{domWrites++;classes.delete(name);},contains:name=>classes.has(name)};
        this.textContent = ''; this.isConnected = true;
    }
    contains(node) { return this===node || this.children.some(child=>child.contains(node)); }
    set className(value) { value.split(' ').filter(Boolean).forEach(name=>this.classList.add(name)); }
    setAttribute(key,value) { domWrites++;this.attributes.set(key,String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { domWrites++;this.attributes.delete(key); }
    addEventListener(type,handler) { this.events[type]=handler; }
    appendChild(child) { child.remove(); child.parentElement=this; this.children.push(child); return child; }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null; }
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this)-1] || null; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this)+1] || null; }
    getClientRects() { layoutReads++;return this.getAttribute('hidden')===null?[{}]:[]; }
    matches(selector) {
        return selector.split(',').some(part=>{
            part=part.trim();
            if(/^[a-z]+$/i.test(part))return this.tagName===part.toUpperCase();
            if(part==='a[href]')return this.tagName==='A' && this.attributes.has('href');
            if(part.startsWith('.'))return this.classList.contains(part.slice(1));
            if(part==='[role="button"][aria-expanded]')return this.getAttribute('role')==='button' && this.attributes.has('aria-expanded');
            const attr=part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
            return !!attr && this.attributes.has(attr[1]) && (attr[2]===undefined || this.getAttribute(attr[1])===attr[2]);
        });
    }
    closest(selector) { return this.matches(selector)?this:this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    click() { this.events.click?.({preventDefault(){},stopPropagation(){}}); }
}
const host = new Element('section'), menu = new Element('div'); menu.setAttribute('role','menu');
let menuOpen = false;
const events = {}, headers = {}, lists = {}, rows = {};
let records = [
    {id:'z',name:'Zulu parent',rooms:['3','1','2','4']},
    {id:'b',name:'Second API child',rooms:['2','5']},
    {id:'a',name:'First alphabetically',rooms:['1']},
    {id:'g',name:'Grandchild',rooms:['3']},
    {id:'r',name:'Independent root',rooms:['1','9']},
    {id:'s',name:'Priority rooms',rooms:['70','71','72','73','74','75']}
];
for(const category of records) {
    const header = headers[category.id] = new Element('div');
    header.setAttribute('role','button');header.setAttribute('aria-expanded','true');header.setAttribute('data-category-id',category.id);
    const trigger = new Element('button');trigger.setAttribute('aria-label','Mở menu danh mục');trigger.setAttribute('aria-haspopup','menu');header.appendChild(trigger);
    trigger.addEventListener('click',()=>{menuOpen=!menuOpen;});
    host.appendChild(header);const list=lists[category.id]=new Element('ul');host.appendChild(list);
    rows[category.id]={};
    for(const id of [...category.rooms].reverse()) {
        const row=rows[category.id][id]=new Element('li');row.setAttribute('data-rid',id);list.appendChild(row);
    }
}
const uncategorizedHeading=new Element('div');uncategorizedHeading.textContent='Các cuộc trò chuyện chưa được phân loại';host.appendChild(uncategorizedHeading);
const uncategorized=new Element('ul');host.appendChild(uncategorized);
const rootRows={};for(const id of ['70','80','81','82']){const row=rootRows[id]=new Element('li');row.setAttribute('data-rid',id);uncategorized.appendChild(row);}
const store = new Map([['thk-toolkit.nativeFolderParents.7',JSON.stringify({b:'z',a:'z',g:'b'})]]);
const window = {CW:{application:{myId:7,domainServiceContext:{customCategoryService:{getSortedCategories(){throw new Error('Do not alphabetize categories');},customCategoryRepository:{getAll:()=>records.map(record=>({identity:record.id,name:record.name,roomIds:record.rooms}))}}},applicationAPIServiceContext:{categoryAPIService:{add(){},update(){}}},applicationServiceContext:{roomListFilterService:{refreshCategory(){}}}}},__thkToolkit:{getLanguage:()=> 'en'}};
window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
const document = {readyState:'loading',addEventListener:(type,handler)=>events[type]=handler,getElementById:()=>null,
    createElement:tag=>new Element(tag),querySelector:()=>host,querySelectorAll:selector=>selector==='[role="menu"]' && menuOpen?[menu]:[]};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/room-folders.js'),'utf8'),{window,document,Date:class extends Date{static now(){return clock;}},setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;},localStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)}});
const folders=window.__thkRoomFolders;
folders.mount();
const visualOrder = elements=>elements.sort((a,b)=>Number(a.style.order)-Number(b.style.order));
assert.deepEqual(visualOrder([...host.children]),[headers.z,headers.b,headers.g,lists.g,lists.b,headers.a,lists.a,lists.z,headers.r,lists.r,headers.s,lists.s,uncategorizedHeading,uncategorized], 'API sibling order is preserved, with child branches before parent rooms');
assert.deepEqual(visualOrder([...lists.z.children]).map(row=>row.getAttribute('data-rid')),['3','1','2','4'],'Room order follows the API instead of DOM order');
const nativeRooms={
    '71':{unreadNumber:{value:2}},
    '72':{isSticky:{value:true},unreadNumber:{value:0}},
    '73':{isPinned:()=>true,messageCountInfo:{unreadMessageCount:{value:5}}},
    '75':{isPinned:{value:false},unreadNumber:{value:0}},
    '5':{sticky:1}, '2':{unreadCount:1}, '81':{unreadNumber:{value:2}}, '82':{isPinned:true}
};
window.CW.application.domainServiceContext.roomService={roomRepository:{entities:nativeRooms}};
window.RM={room_dat:{'74':{sticky:0,unread_num:3},'75':{sticky:1,unread_num:0}}};
rows.s['70'].removeAttribute('data-rid');rows.s['70'].id='70';
const rankedIds=()=>visualOrder([...lists.s.children]).map(row=>Object.entries(rows.s).find(([,node])=>node===row)[0]);
folders.mount();
assert.deepEqual(rankedIds(),['73','72','71','74','70','75'],'Pinned rooms lead; unread rooms lead within each bucket; API order breaks ties');
assert.ok(uncategorized.classList.contains('thk-native-root-rooms'),'Unclassified conversations join the folder room layout');
assert.ok(Number(uncategorizedHeading.style.order)>Number(lists.s.style.order),'Unclassified heading follows the folders');
assert.ok(Number(uncategorized.style.order)>Number(uncategorizedHeading.style.order));
assert.deepEqual(visualOrder([...uncategorized.children]).filter(row=>row.getAttribute('data-thk-folder-room-hidden')!=='true').map(row=>row.getAttribute('data-rid')),['82','81','80'],'Unclassified chats share pin/unread priority below folders');
assert.equal(rootRows['70'].getAttribute('data-thk-folder-room-hidden'),'true','Categorized rooms are not repeated under unclassified conversations');
assert.deepEqual(visualOrder([...lists.b.children]),[rows.b['5'],rows.b['2']],'Priorities also apply inside nested folders');
nativeRooms['71'].unreadNumber.value=0;folders.mount();
assert.deepEqual(rankedIds(),['73','72','74','70','71','75'],'Reading a chat restores its API position');
nativeRooms['72'].isSticky.value=false;folders.mount();
assert.deepEqual(rankedIds(),['73','74','70','71','72','75'],'Unpinning updates folder order');
rows.s['75']['__reactFiber$test']={memoizedProps:{isPinned:true,roomId:'75'}};folders.mount();
assert.deepEqual(rankedIds(),['73','75','74','70','71','72'],'Current rendered pin state overrides stale repository state');
const badge=new Element('span');badge.className='roomBadge';badge.textContent='6';rows.s['70'].appendChild(badge);folders.mount();
assert.deepEqual(rankedIds(),['73','75','70','74','71','72'],'Visible notification badges are supported without room metadata');
badge.setAttribute('hidden','true');folders.mount();
assert.deepEqual(rankedIds(),['73','75','74','70','71','72'],'Hidden notification badges do not raise read rooms');
// Stable sidebar refreshes must neither invalidate layout nor measure row geometry.
folders.mount();const writesBefore=domWrites,readsBefore=layoutReads;
for(let i=0;i<20;i++)folders.mount();
assert.equal(domWrites,writesBefore,'Unchanged refreshes do not rewrite DOM attributes/classes/styles');
assert.equal(layoutReads,readsBefore,'Sorting never forces synchronous geometry reads');
host.events.wheel();folders.scheduleMount();folders.scheduleMount();
assert.equal(frames.length,0);assert.equal(timers.length,1,'Scroll-time updates are coalesced into one deferred refresh');
clock=100;host.events.scroll();clock=180;timers.shift().callback();
assert.equal(frames.length,0,'A continued gesture extends the deferral');
clock=300;timers.shift().callback();assert.equal(frames.length,1);frames.shift()();
assert.equal(domWrites,writesBefore,'Settling a scroll leaves unchanged rows untouched');
clock=500;folders.scheduleMount();host.events.scroll();nativeRooms['71'].unreadNumber.value=5;frames.shift()();
assert.equal(domWrites,writesBefore,'New notifications do not reorder rows while scrolling');
clock=700;timers.shift().callback();frames.shift()();
assert.deepEqual(rankedIds(),['73','75','71','74','70','72'],'Notification priority updates after scrolling settles');
for(const id of ['1','2','3'])assert.equal(rows.z[id].getAttribute('data-thk-folder-room-hidden'),'true','Parent duplicates include rooms in grandchildren');
assert.equal(rows.z['4'].getAttribute('data-thk-folder-room-hidden'),'false');
assert.equal(rows.r['1'].getAttribute('data-thk-folder-room-hidden'),'false','Unrelated branches retain their own memberships');
assert.equal(headers.z.querySelector('.thk-native-folder-tools'),null,'Actions do not appear in category headings');
function openMenu(id) {
    const trigger=headers[id].children[0];events.click({target:trigger});trigger.click();folders.mount();
}
openMenu('b');
assert.equal(menu.children.length,1);assert.equal(menu.children[0].children.length,2,'Only create-child and change-parent actions remain');
folders.mount();assert.equal(menu.children.length,1,'Repeated mounts do not duplicate menu actions');
assert.deepEqual(menu.children[0].children.map(button=>button.getAttribute('data-thk-folder-action')),['child','parent']);
assert.equal(window.__thkFolderAuto,undefined,'Automatic grouping is not registered');
events.keydown({key:'Escape'});menuOpen=false;assert.equal(menu.children.length,0);
headers.b.setAttribute('aria-expanded','false');folders.mount();
assert.equal(headers.g.getAttribute('data-thk-folder-hidden'),'true');
assert.equal(lists.b.getAttribute('data-thk-folder-hidden'),'true','Collapsed categories hide their own room list');
assert.equal(headers.a.getAttribute('data-thk-folder-hidden'),'false');
folders.reparent('b','');folders.mount();
assert.equal(rows.z['2'].getAttribute('data-thk-folder-room-hidden'),'false','Moving a child restores rooms in its former parent');
assert.equal(rows.z['3'].getAttribute('data-thk-folder-room-hidden'),'false');
assert.equal(rows.z['1'].getAttribute('data-thk-folder-room-hidden'),'true');
records=records.map(record=>record.id==='a'?{...record,rooms:[]}:record);folders.mount();
assert.equal(rows.z['1'].getAttribute('data-thk-folder-room-hidden'),'false','Membership refresh restores parent items');
openMenu('a');events.keydown({key:'Escape'});assert.equal(menu.children.length,0);
menuOpen=false;openMenu('z');window.CW.application.myId=8;folders.mount();assert.equal(menu.children.length,0,'Account changes clear category actions');
window.CW.application.myId=7;folders.mount();
// Native Chatwork renders categories and unclassified chats in separate resizable panes.
const categoryPane=new Element('div'), rootPane=new Element('div'), splitter=new Element('div');splitter.setAttribute('role','separator');
for(const element of [...host.children])if(element!==uncategorized && element!==uncategorizedHeading)categoryPane.appendChild(element);
rootPane.appendChild(uncategorizedHeading);rootPane.appendChild(uncategorized);host.appendChild(categoryPane);host.appendChild(splitter);host.appendChild(rootPane);
folders.mount();
assert.ok(host.classList.contains('thk-native-unified-room-scroll'),'Both native panes use one shared scroll host');
assert.ok(categoryPane.classList.contains('thk-native-room-flow') && rootPane.classList.contains('thk-native-room-flow'),'Independent pane heights and overflow are released');
assert.ok(splitter.classList.contains('thk-native-room-divider'),'The resize splitter is removed from the shared flow');
assert.ok(Number(rootPane.style.order)>Number(categoryPane.style.order),'Unclassified conversations follow all folder branches');
const parentsBeforeToggle=store.get('thk-toolkit.nativeFolderParents.7');
folders.setMergeEnabled(false);
assert.equal(folders.isMergeEnabled(),false);assert.equal(store.get('thk-toolkit.nativeFolderMerge.7'),'false');
window.CW.application.myId=8;assert.equal(folders.isMergeEnabled(),true,'Merge preferences are isolated per account');
window.CW.application.myId=7;assert.equal(folders.isMergeEnabled(),false);
assert.equal(host.classList.contains('thk-native-unified-room-scroll'),false);
assert.equal(splitter.classList.contains('thk-native-room-divider'),false,'Turning merge off restores the native divider');
assert.equal(uncategorized.classList.contains('thk-native-root-rooms'),false);
assert.equal(rootRows['70'].getAttribute('data-thk-folder-room-hidden'),null);
assert.equal(rootPane.style.order,'');assert.equal(uncategorizedHeading.style.order,'');
assert.equal(store.get('thk-toolkit.nativeFolderParents.7'),parentsBeforeToggle,'Merge preference does not alter the folder tree');
folders.setMergeEnabled(true);assert.equal(folders.isMergeEnabled(),true);
assert.ok(host.classList.contains('thk-native-unified-room-scroll'));
assert.ok(splitter.classList.contains('thk-native-room-divider'));
records=[];folders.mount();
assert.equal(host.classList.contains('thk-native-folder-list'),false);
assert.equal(rows.z['1'].getAttribute('data-thk-folder-room-hidden'),null,'Removing categories restores native row styling');
assert.equal(rows.z['1'].style.order,'');assert.equal(lists.z.style.order,'');
document.querySelector=()=>null;folders.mount();
assert.equal(uncategorized.classList.contains('thk-native-root-rooms'),false);
assert.equal(host.classList.contains('thk-native-unified-room-scroll'),false);
assert.equal(rootPane.classList.contains('thk-native-room-flow'),false);
assert.equal(splitter.classList.contains('thk-native-room-divider'),false);
assert.equal(rootRows['70'].getAttribute('data-thk-folder-room-hidden'),null);
assert.equal(rootRows['82'].style.order,'');assert.equal(uncategorizedHeading.style.order,'');
const injected=fs.readFileSync(path.join(__dirname,'../src/injected.js'),'utf8');
const watcherStart=injected.indexOf('    function initDynamicWatchers() {');
const watcherSource=injected.slice(watcherStart,injected.indexOf('    if (document.readyState',watcherStart));
let dynamicUpdates=0,dynamicScrolling=false,dynamicObserver;const dynamicTimers=[];
const dynamicContext={document:{body:{}},window:{__thkRoomFolders:{isScrolling:()=>dynamicScrolling},addEventListener(){}},
    injectThkStyles(){dynamicUpdates++;},setupQuickToolbar(){dynamicUpdates++;},setupDescriptionToolbar(){dynamicUpdates++;},attachCodeCopyButtons(){dynamicUpdates++;},
    setTimeout(callback){dynamicTimers.push(callback);return dynamicTimers.length;},setInterval(){},MutationObserver:class{constructor(callback){dynamicObserver=callback;}observe(){}}};
vm.runInNewContext(watcherSource+'\ninitDynamicWatchers();',dynamicContext);
assert.equal(dynamicUpdates,4);
for(let i=0;i<20;i++)dynamicObserver();assert.equal(dynamicTimers.length,1,'Page mutation bursts produce one dynamic toolbar refresh');
dynamicScrolling=true;dynamicTimers.shift()();assert.equal(dynamicUpdates,4,'Formatting UI work is also deferred while scrolling the sidebar');
dynamicScrolling=false;dynamicTimers.shift()();assert.equal(dynamicUpdates,8);
console.log('Folder priorities, merge toggle, stable DOM refreshes and scroll-time update batching checks passed.');
