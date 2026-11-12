const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {Blob}=require('node:buffer');
const {TextDecoder}=require('node:util');
const window={__thkToolkit:{getLanguage:()=> 'en'}};
const context=vm.createContext({window,Blob,TextDecoder,DataView,Uint8Array,Map,DOMException});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/file-preview.js'),'utf8'),context);
const api=window.__thkFilePreview;
for(const [name,category,kind] of [['a.PNG','image','image'],['demo.mp4','video','video'],['spec.PDF','document','pdf'],['a.docx','document','docx'],['a.xlsx','document','xlsx'],['a.pptx','document','pptx'],['sample.html','other','text'],['backup.zip','other','unsupported']])assert.equal(api.kind({name,category}),kind);
(async()=>{
 const bytes=await api.readStream(new Blob(['hello']).stream(),10);
 assert.equal(await bytes.text(),'hello');
 await assert.rejects(api.readStream(new Blob(['a'.repeat(20)]).stream(),10),/too large/);
 await assert.rejects(api.officeArchive(new Blob(['not a zip']),{aborted:false}));
 console.log('Preview types, bounded streaming and invalid archive rejection passed.');
})();
