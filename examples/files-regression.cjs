const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const window={CW:{application:{domainServiceContext:{userService:{userRepository:{entities:{7:{name:{value:'Nguyễn An'}}}}}}}}};
const context=vm.createContext({window,location:{origin:'https://www.chatwork.com'},URL,Set,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/files.js'),'utf8'),context);
const api=window.__thkFiles;
assert.equal(api.category('PHOTO.JPG'),'image');
assert.equal(api.category('report.docx'),'document');
assert.equal(api.category('recording.MOV'),'video');
assert.equal(api.category('backup.zip'),'other');
assert.equal(api.category('stream','video/mp4'),'video');
const files=api.normalizeFiles({result:{file_dat:{
  101:{fn:'screenshot.png',aid:7,fs:1024},
  102:{filename:'Spec.pdf',account_id:7,download_url:'https://appdata.chatwork.com/gateway/download_file.php?file_id=102'},
  103:{id:103,name:'clip.mp4',url:'javascript:alert(1)'},
  104:{name:'backup.zip',url:'https://chatwork.com.evil.test/download'},
  invalid:{name:'not a valid attachment'}
}}});
assert.equal(files.length,4);
assert.equal(files[0].uploader,'Nguyễn An');
assert.equal(files[0].size,1024);
assert.equal(files[2].url,'');assert.equal(files[3].url,'');
assert.equal(api.filterFiles(files,'document','nguyen')[0].name,'Spec.pdf');
assert.equal(api.filterFiles(files,'video','CLIP').length,1);
assert.equal(api.filterFiles(files,'image','spec').length,0);
assert.equal(api.normalizeFiles({result:{file_list:[]}}).length,0);
assert.equal(api.normalizeFiles({result:{contact_dat:{}}}),null,'Unknown schemas cannot be shown as an empty file list');
assert.equal(api.normalizeFiles({result:{files:[{id:1,name:'a.txt'},{id:1,name:'duplicate.txt'}]}}).length,1);
console.log('File categorization, filters, metadata and URL validation passed.');
