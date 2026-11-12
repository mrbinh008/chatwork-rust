// Run with: node examples/native-folders-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let records = {a:{name:'Projects',list:['42']},b:{name:'Team A',list:['43']},c:{name:'Empty',list:[]}};
const stored = new Map(), calls = [], refreshes = [];
const api = {
    async add(name, rooms) { calls.push(['add',name,rooms]); return 'new'; },
    async update(id, name, rooms) { calls.push(['update',id,name,rooms]); return {name:name.trim(),list:rooms}; }
};
const window = {__thkToolkit:{getLanguage:()=> 'vi'},CW:{application:{myId:{value:'7'},
    domainServiceContext:{customCategoryService:{getSortedCategories:()=>Object.entries(records).map(([id,record])=>({identity:{value:id},name:{value:record.name},roomIds:record.list.map(value=>({value}))}))}},
    applicationAPIServiceContext:{categoryAPIService:api},
    applicationServiceContext:{roomListFilterService:{refreshCategory(all){refreshes.push(all);records=all;}}}
}}};
const storage = {getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
const document = {readyState:'loading',addEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
const context = vm.createContext({window,document,localStorage:storage,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/room-folders.js'),'utf8'),context);
const folders = window.__thkRoomFolders;
const plain = value => JSON.parse(JSON.stringify(value));
(async () => {
    assert.equal(folders.getTree().length,3,'Existing native categories are used directly');
    folders.reparent('b','a'); folders.reparent('c','b');
    let tree = folders.getTree();
    assert.equal(tree[0].children[0].id,'b');
    assert.equal(tree[0].children[0].children[0].id,'c','Nesting supports more than two levels');
    assert.deepEqual(plain(tree[0].children[0].rooms),['43'],'Native room assignments are preserved');
    assert.equal(calls.length,0,'Moving a category only stores its parent relationship');
    assert.throws(()=>folders.reparent('a','c'));
    assert.throws(()=>folders.reparent('b','missing'));
    assert.throws(()=>folders.reparent('b','b'));
    assert.equal(folders.getTree()[0].id,'a','Invalid parent changes do not damage the tree');
    folders.reparent('b',''); assert.equal(folders.getTree().length,2,'A category can be returned to root');
    const cyclic=folders.buildTree([{id:'x',name:'X',rooms:[]},{id:'y',name:'Y',rooms:[]}],{x:'y',y:'x'});
    assert.equal(cyclic.length,2,'Malformed cyclic metadata cannot hide native categories');
    assert.equal(folders.buildTree([{id:'x',name:'X',rooms:[]}],{x:'deleted'}).length,1,'Deleted parents leave surviving native categories accessible');
    window.CW.application.myId.value='other';
    assert.equal(folders.getTree().length,3,'Folder nesting is scoped to the current account');
    window.CW.application.myId.value='7';
    const id=await folders.saveCategory('Native child',['42','43']);
    assert.equal(id,'new'); assert.deepEqual(plain(calls[0]),['add','Native child',['42','43']]);
    assert.deepEqual(Object.keys(records).sort(),['a','b','c','new'],'Native refresh receives every existing category');
    assert.deepEqual(plain(records.a),{name:'Projects',list:['42']});
    folders.reparent(id,'a');
    assert.ok(folders.getTree()[0].children.some(folder=>folder.id==='new'));
    await folders.saveCategory(' Native rename ',['43'],'new');
    assert.equal(records.new.name,'Native rename','The server-normalized update response is used');
    assert.deepEqual(plain(records.new.list),['43']);
    let resolveAdd;
    api.add=()=>new Promise(resolve=>{resolveAdd=resolve;});
    const pending=folders.saveCategory('Concurrent child',[]);
    records.parallel={name:'Created by native UI while the request runs',list:['42']};
    resolveAdd('another'); await pending;
    assert.ok(records.parallel,'Concurrent native category changes are not overwritten');
    const before=JSON.stringify(records), parentsBefore=stored.get('thk-toolkit.nativeFolderParents.7'), countBefore=refreshes.length;
    api.add=async()=>{throw new Error('Server rejected category');};
    await assert.rejects(folders.saveCategory('Rejected',[]),/Server rejected/);
    assert.equal(JSON.stringify(records),before);
    assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),parentsBefore);
    assert.equal(refreshes.length,countBefore,'Failed server saves never refresh or remove native categories');
    storage.setItem=()=>{throw new Error('Storage full');};
    assert.throws(()=>folders.reparent('new','b'),/Storage full/);
    assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),parentsBefore);
    folders.mount();
    console.log('Native category nesting, account isolation, API persistence, concurrent updates and failure handling checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
