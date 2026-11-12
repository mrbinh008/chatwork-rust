// Run with: node examples/downloads-regression.cjs
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const handlers=[];const frames=[];const anchors=[];const external=[];
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.attrs={};this.textContent='';this.title='';if(tag==='iframe'){this.contentWindow={location:{href:'about:blank'}};frames.push(this);}}
 setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key]??null;}hasAttribute(key){return key in this.attrs;}
 closest(){return this;}
 click(){const event={target:this,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};for(const fn of handlers){fn(event);if(event.stopped)break;}if(!event.prevented&&this.tagName==='A')anchors.push({url:this.href,filename:this.download});}
 remove(){}
}
const document={body:{appendChild(){}},createElement:tag=>new Element(tag),addEventListener:(name,fn)=>{if(name==='click')handlers.push(fn);}};
const window={open(...args){external.push(args);return {external:true};}};
const context=vm.createContext({window,document,location:{href:'https://www.chatwork.com/#!rid1'},URL,Date});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/downloads.js'),'utf8'),context);
const link=new Element('a');link.href='https://appdata.chatwork.com/gateway/download_file.php?file_id=1';link.setAttribute('download','report.txt');link.click();
assert.equal(frames.length,1);assert.equal(frames[0].src,link.href);assert.equal(external.length,0);
const button=new Element('button');button.textContent='Download';button.click();const popup=window.open('about:blank');assert.equal(popup,frames[1].contentWindow,'Blank download popup stays in same WebView session');
window.open('https://auth.example.com/login','oauth');assert.equal(external.length,1,'Normal auth popup behavior preserved');
window.__thk_startDownload('blob:https://www.chatwork.com/uuid','blob.txt');assert.deepEqual(anchors.at(-1),{url:'blob:https://www.chatwork.com/uuid',filename:'blob.txt'});
const count=frames.length;assert.equal(window.__thk_startDownload('javascript:alert(1)'),null);assert.equal(frames.length,count);
window.open('https://example.com/?link=chatwork.com/download');assert.equal(external.length,2,'Unrelated external links preserved');
console.log('Authenticated file, popup, blob and external navigation routing checks passed.');
