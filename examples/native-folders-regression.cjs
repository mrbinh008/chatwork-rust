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
    domainServiceContext:{customCategoryService:{customCategoryRepository:{getAll:()=>Object.entries(records).map(([id,record])=>({identity:{value:id},name:{value:record.name},roomIds:record.list.map(value=>({value}))}))}}},
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
    const service=window.CW.application.domainServiceContext.customCategoryService;
    service.getSortedCategories=()=>{throw new Error('Alphabetical category sorting must not be called');};
    assert.deepEqual(plain(folders.getTree().map(folder=>folder.id)),['a','b','c'],'Repository order is used even when names are not alphabetical');
    const getAll=service.customCategoryRepository.getAll;
    service.customCategoryRepository={entities:Object.fromEntries(getAll().map(category=>[category.identity.value,category]))};
    assert.deepEqual(plain(folders.getTree().map(folder=>folder.id)),['a','b','c'],'Repository entities retain server order');
    service.customCategoryRepository={getAll};
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
    const snapshot=plain(folders.exportTree());
    assert.equal(snapshot.format,'thk-chat.folder-tree');assert.equal(snapshot.version,1);assert.equal(snapshot.accountId,'7');
    assert.equal(snapshot.folders.find(folder=>folder.id==='new').parentId,'a');
    assert.ok(snapshot.folders.every(folder=>!('rooms' in folder)),'Only folder structure is exported');
    records.local={name:'Added on this device',list:['keep']};folders.reparent('local','a');
    folders.reparent('new','b');
    const previewBefore=stored.get('thk-toolkit.nativeFolderParents.7');
    const preview=folders.previewImport(snapshot);assert.equal(preview.changes,1);
    assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),previewBefore,'Preview does not change local storage');
    const writesBefore=calls.length;
    folders.importTree(snapshot);
    assert.equal(folders.exportTree().folders.find(folder=>folder.id==='new').parentId,'a');
    assert.equal(folders.exportTree().folders.find(folder=>folder.id==='local').parentId,'a','Device-only folders are preserved');
    assert.equal(calls.length,writesBefore,'Tree imports do not change server categories or memberships');
    assert.deepEqual(plain(records.local.list),['keep']);
    assert.equal(folders.previewImport(snapshot).changes,0,'Importing the same tree is idempotent');
    const importedBefore=stored.get('thk-toolkit.nativeFolderParents.7');
    for(const bad of [
        {...snapshot,accountId:'other'}, {...snapshot,version:2},
        {...snapshot,folders:[...snapshot.folders,snapshot.folders[0]]},
        {...snapshot,folders:[{id:'a',parentId:'b'},{id:'b',parentId:'a'}]},
        {...snapshot,folders:[{id:'a',parentId:'missing'}]}
    ]) {
        assert.throws(()=>folders.importTree(bad));
        assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),importedBefore,'Invalid imports are atomic');
    }
    const missing={...snapshot,folders:[...snapshot.folders,{id:'not-yet-synced',parentId:''}]};
    assert.equal(folders.importTree(missing).skipped,1,'Unavailable server categories are reported and skipped');
    folders.reparent('c','a');
    const mixedCycle={...snapshot,folders:[{id:'a',parentId:'c'},{id:'c',parentId:'missing-parent'},{id:'missing-parent',parentId:''}]};
    assert.throws(()=>folders.importTree(mixedCycle),'Imports cannot create cycles through preserved local relationships');
    const beforeQuota=stored.get('thk-toolkit.nativeFolderParents.7');
    storage.setItem=()=>{throw new Error('Storage full');};
    assert.throws(()=>folders.importTree(snapshot),/Storage full/);
    assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),beforeQuota,'Failed imports leave the original tree intact');
    assert.throws(()=>folders.reparent('new','b'),/Storage full/);
    assert.equal(stored.get('thk-toolkit.nativeFolderParents.7'),beforeQuota);
    folders.mount();
    console.log('Native category nesting, account isolation, API persistence, tree import/export and failure handling checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
