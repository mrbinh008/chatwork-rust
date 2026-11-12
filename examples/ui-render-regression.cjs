// Run with: node examples/ui-render-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../src/injected.js'),'utf8');
new vm.Script(source);
const context = vm.createContext({window:{}});
vm.runInContext(source.slice(source.indexOf('    function parseMarkdownAndBBCode'),source.indexOf('    let closePreview')),context);
const render = context.parseMarkdownAndBBCode;
const request='[info]\n- Request: PAID_LEAVE\n- Time: 08:00 - 17:00  12/11/2026\n- Reason: Personal matter\n[/info]\n';
const html=render(request);
assert.ok(html.includes('class="thk-md-info"'));
assert.ok(html.includes('- Request: PAID_LEAVE\n- Time:'));
assert.ok(!html.includes('<em>')&&!html.includes('<li'), 'Chatwork keeps underscores and dash lists literal');
assert.ok(!html.includes('>\n- Request'), 'Formatting newline after [info] is not an empty preview line');
assert.ok(render('[info]\n[title]Title[/title]\nBody\n[/info]').includes('thk-md-info-title'));
assert.ok(render('**bold**\n# Heading').includes('**bold**\n# Heading'));
assert.ok(!render('**bold**').includes('<strong>'));
assert.ok(render('[code]\n  <div>x</div>\n\n[/code]').includes('  &lt;div&gt;x&lt;/div&gt;\n</code>'), 'Code indentation and inner blank lines stay intact');
assert.ok(!render('[code]https://example.com[/code]').includes('<a'));
assert.ok(render('<img src=x onerror=alert(1)>').includes('&lt;img'));
assert.ok(!render('<img src=x onerror=alert(1)>').includes('<img'));
assert.ok(render('https://example.com/path?a=1&b=2').includes('href="https://example.com/path?a=1&amp;b=2"'));
assert.ok(render('[info]unfinished').includes('[info]unfinished'));
assert.ok(render('THKCB0XYZ').includes('THKCB0XYZ'));
assert.ok(render('[hr]\nNext').includes('<hr class="thk-md-hr">'));
assert.ok(render('[toall]\n[info]\nProject name: Test\n[/info]').includes('TO ALL</span>'));
assert.ok(render('[toall]\nNext').includes('\nNext'));

let copied=null;
class Block {
    constructor(text,kind='code'){this.text=text;this.kind=kind;this.buttons=[];this.classList={add(){},remove(){}};}
    closest(){return this.kind==='preview'?{}:null;}
    matches(){return this.kind==='semantic';}
    querySelector(selector){if(selector===':scope > code')return this.kind==='semantic'?{}:null;if(selector==='pre')return null;return this.buttons[0]||null;}
    querySelectorAll(){return this.buttons;}
    appendChild(button){button.parentBlock=this;this.buttons.push(button);}
    cloneNode(){const block=this;let hasButton=true;return {querySelectorAll:()=>[{remove(){hasButton=false;}}],get textContent(){return block.text+(hasButton?'button UI':'');}};}
}
const outer=new Block('ordinary message','normal');
const info=new Block('Info body','info');
info.buttons.push({remove(){info.buttons=[];}});
const code=new Block('  indented\r\n\r\n  last line  \n');
const semantic=new Block('explicit code','semantic');
const preview=new Block('preview','preview');
const document={querySelectorAll:()=>[outer,info,code,semantic,preview],createElement:()=>({classList:{add(){},remove(){}},setAttribute(){},remove(){this.parentBlock.buttons.splice(this.parentBlock.buttons.indexOf(this),1);},addEventListener(name,fn){this[name]=fn;}})};
const copyContext=vm.createContext({document,setTimeout(){},getComputedStyle:block=>({fontFamily:block.kind==='code'?'Consolas, monospace':'Segoe UI, sans-serif'}),copyTextToClipboard:async text=>{copied=text;}});
vm.runInContext(source.slice(source.indexOf('    function getCodeText'),source.indexOf('    // ── 17.')),copyContext);
copyContext.attachCodeCopyButtons();copyContext.attachCodeCopyButtons();
assert.equal(outer.buttons.length,0,'No copy icon on ordinary message pre');
assert.equal(info.buttons.length,0,'Remove previous copy controls from Info bodies');
assert.equal(preview.buttons.length,0,'No injected copy icons in popups');
assert.equal(code.buttons.length,1,'One copy icon per real monospaced code block');
assert.equal(semantic.buttons.length,1,'Explicit code tags work without relying on native font');
assert.ok(code.buttons[0].innerHTML.includes('<svg'));
assert.ok(!code.buttons[0].innerHTML.includes('>Copy<'),'Icon only');
(async()=>{
    await code.buttons[0].click({preventDefault(){},stopPropagation(){}});
    assert.equal(copied,'  indented\n\n  last line  \n','Copy preserves whitespace and omits UI');
    assert.equal(code.buttons[0].title,'Đã sao chép');
    assert.ok(code.buttons[0].innerHTML.includes('<polyline'));
    console.log('Chatwork preview and code-only copy icon regression checks passed.');
})();
