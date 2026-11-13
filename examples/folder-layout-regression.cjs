// Run with: node examples/folder-layout-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
class Element {
    constructor(tag) {
        this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map(); this.events = {};
        this.style = {order:'',setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};
        const classes = new Set(); this.classList = {add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
        this.textContent = ''; this.isConnected = true;
    }
    set className(value) { value.split(' ').filter(Boolean).forEach(name=>this.classList.add(name)); }
    setAttribute(key,value) { this.attributes.set(key,String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    addEventListener(type,handler) { this.events[type]=handler; }
    appendChild(child) { child.remove(); child.parentElement=this; this.children.push(child); return child; }
    remove() { if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this)+1] || null; }
    getClientRects() { return this.getAttribute('hidden')===null?[{}]:[]; }
    matches(selector) {
        return selector.split(',').some(part=>{
            part=part.trim();
            if(part==='button')return this.tagName==='BUTTON';
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
    {id:'r',name:'Independent root',rooms:['1','9']}
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
const store = new Map([['thk-toolkit.nativeFolderParents.7',JSON.stringify({b:'z',a:'z',g:'b'})]]);
const window = {CW:{application:{myId:7,domainServiceContext:{customCategoryService:{getSortedCategories(){throw new Error('Do not alphabetize categories');},customCategoryRepository:{getAll:()=>records.map(record=>({identity:record.id,name:record.name,roomIds:record.rooms}))}}},applicationAPIServiceContext:{categoryAPIService:{add(){},update(){}}},applicationServiceContext:{roomListFilterService:{refreshCategory(){}}}}},__thkToolkit:{getLanguage:()=> 'en'}};
const document = {readyState:'loading',addEventListener:(type,handler)=>events[type]=handler,getElementById:()=>null,
    createElement:tag=>new Element(tag),querySelector:()=>host,querySelectorAll:selector=>selector==='[role="menu"]' && menuOpen?[menu]:[]};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/room-folders.js'),'utf8'),{window,document,localStorage:{getItem:key=>store.get(key),setItem:(key,value)=>store.set(key,value)}});
const folders=window.__thkRoomFolders;
folders.mount();
const visualOrder = elements=>elements.sort((a,b)=>Number(a.style.order)-Number(b.style.order));
assert.deepEqual(visualOrder([...host.children]),[headers.z,headers.b,headers.g,lists.g,lists.b,headers.a,lists.a,lists.z,headers.r,lists.r], 'API sibling order is preserved, with child branches before parent rooms');
assert.deepEqual(visualOrder([...lists.z.children]).map(row=>row.getAttribute('data-rid')),['3','1','2','4'],'Room order follows the API instead of DOM order');
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
records=[];folders.mount();
assert.equal(host.classList.contains('thk-native-folder-list'),false);
assert.equal(rows.z['1'].getAttribute('data-thk-folder-room-hidden'),null,'Removing categories restores native row styling');
assert.equal(rows.z['1'].style.order,'');assert.equal(lists.z.style.order,'');
console.log('Folder API order, child-first layout, duplicate visibility, native menus, collapse, reparenting and cleanup checks passed.');
