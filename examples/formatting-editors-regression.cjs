// Run with: node examples/formatting-editors-regression.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/injected.js'),'utf8');
const listeners={};
const document={activeElement:null,querySelector:selector=>selector==='#_chatText'?composer:null,execCommand:()=>false,addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn)};
function editor(value='') {return {tagName:'TEXTAREA',value,selectionStart:0,selectionEnd:value.length,closest:()=>null,focus(){document.activeElement=this;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},dispatchEvent(){}};}
const composer=editor('Existing chat draft');const description=editor();
let previewEditor=null,mentionCalls=0;
const context=vm.createContext({document,window:{addEventListener(){}},navigator:{platform:'Win32'},Event:class{},mentionDropdownEl:null,mentionFilteredList:[],checkMentionTrigger(){mentionCalls++;},closeMentionDropdown(){},openLeaveRequestModal(){}});
const helpers=source.slice(source.indexOf('    function getChatText()'),source.indexOf('    // ── 11.'));
const bindingStart=source.indexOf('    function setupChatKeyBindings()');
const bindings=source.slice(bindingStart,source.indexOf('    setupChatKeyBindings();',bindingStart));
vm.runInContext(helpers+bindings+'\nfunction openMarkdownPreviewModal(){globalThis.previewEditor=getFormattingEditor();}\nsetupChatKeyBindings();',context);
function shortcut(key,shift=false){const event={key,ctrlKey:true,metaKey:false,shiftKey:shift,altKey:false,isComposing:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){}};listeners.keydown.forEach(fn=>fn(event));return event;}
description.value='Description';description.setSelectionRange(0,11);description.focus();
assert.ok(shortcut('i').prevented);assert.equal(description.value,'[info]\nDescription\n[/info]\n');
assert.equal(composer.value,'Existing chat draft','Info must not overwrite the chat composer');
description.value='';description.setSelectionRange(0,0);shortcut('i',true);
assert.ok(description.value.startsWith('[info]\n[title]'));assert.ok(description.value.endsWith('[/info]\n'));
description.value='const value = 42;';description.setSelectionRange(0,description.value.length);shortcut('k');
assert.equal(description.value,'[code]\nconst value = 42;\n[/code]\n');
description.value='';description.setSelectionRange(0,0);shortcut('h');assert.equal(description.value,'[hr]\n');
shortcut('p',true);assert.equal(context.previewEditor,description,'Preview uses focused description field');
const before=description.value;shortcut('m');assert.equal(description.value,before);assert.equal(mentionCalls,0);
composer.focus();shortcut('p',true);assert.equal(context.previewEditor,composer);
context.navigator.platform='MacIntel';description.value='Mac description';description.setSelectionRange(0,description.value.length);description.focus();
listeners.keydown.forEach(fn=>fn({key:'i',ctrlKey:false,metaKey:true,shiftKey:false,altKey:false,isComposing:false,preventDefault(){},stopImmediatePropagation(){}}));
assert.equal(description.value,'[info]\nMac description\n[/info]\n','Cmd shortcut targets description on Mac');
console.log('Description Info, Title, Code, HR and Preview shortcut checks passed.');
