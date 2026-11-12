// Run against an isolated THK-Chat test instance with CDP enabled:
// THK_TEST_CDP=http://127.0.0.1:9226 node examples/theme-regression.cjs
// Document requests are replaced with a local fixture; no account is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const endpoint = process.env.THK_TEST_CDP || 'http://127.0.0.1:9226';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px system-ui;margin:20px;background:white;color:#222}
#_sidebarPane{width:280px;padding:15px}#CurrentSelectedRoom{padding:20px}
textarea{display:block;width:350px;height:100px}#description{padding:20px;border:1px solid #ddd}
</style></head><body><aside id="_sidebarPane"><div id="_roomListArea" class="roomListWithSwitch">
<div class="thk-native-folder-heading"><span>Projects</span></div><div data-rid="42">Room / Group / User</div></div></aside>
<section id="CurrentSelectedRoom"><div id="_timeLine"><p class="chatTimeLineMessage">A readable message</p></div>
<ul id="_chatSendTool"></ul><textarea id="_chatText">Draft</textarea></section>
<div id="description"><h2>Edit description</h2><div><textarea>Group description</textarea></div></div>
<div class="thk-mention-dropdown"><div class="thk-mention-item">User name <span class="thk-mention-sub">Team name</span></div></div>
</body></html>`;
function luminance(color) {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number);
    return rgb.map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; })
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
(async () => {
    const targets = await (await fetch(endpoint + '/json/list')).json();
    const page = targets.find(item => item.type === 'page');
    assert.ok(page, 'A native test WebView is running');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    const pending = new Map(), errors = [], results = [];
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
            pending.set(id, {resolve(value) {clearTimeout(timer); resolve(value);}, reject});
            socket.send(JSON.stringify({id, method, params}));
        });
    }
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const task = pending.get(message.id); pending.delete(message.id);
            if (message.error) task?.reject(Error(message.error.message)); else task?.resolve(message.result);
        } else if (message.method === 'Fetch.requestPaused') {
            send('Fetch.fulfillRequest', {requestId:message.params.requestId, responseCode:200,
                responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}], body:Buffer.from(fixture).toString('base64')}).catch(error => errors.push(String(error)));
        } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    };
    async function evaluate(expression) {
        const response = await send('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
        assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        return response.result.value;
    }
    async function wait(expression) {
        for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
        assert.fail('Timed out: ' + expression);
    }
    try {
        await send('Runtime.enable'); await send('Page.enable');
        await send('Fetch.enable', {patterns:[{urlPattern:'https://www.chatwork.com/*',resourceType:'Document'}]});
        for (const platform of ['Win32', 'MacIntel']) {
            await send('Emulation.setUserAgentOverride', {userAgent:'Mozilla/5.0 THK-Theme-Test', platform});
            // Start dark, then switch twice without navigation or remounting the popup.
            await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-color-scheme',value:'dark'}]});
            await send('Page.navigate', {url:'https://www.chatwork.com/?thk-theme-test=' + Date.now()});
            await wait(`!!window.__thkToolkit && !!document.querySelector('.thk-description-toolbar')`);
            await evaluate('window.__thkToolkit.openSettings()');
            for (const theme of ['dark', 'light', 'dark']) {
                await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-color-scheme',value:theme}]});
                await wait(`document.documentElement.dataset.thkTheme === '${theme}'`);
                await delay(350); // Let existing button transitions and popup entry animations settle.
                const colors = await evaluate(`(() => {
                    const selectors=['body','#_sidebarPane','#_roomListArea [data-rid]','.thk-native-folder-heading span','.chatTimeLineMessage','#_chatText','.thk-description-dialog','.thk-description-editor','.thk-description-shortcut','.thk-mention-item','.thk-mention-sub','#thk-toolkit-panel .thk-modal-box','#thk-toolkit-panel .thk-modal-header','#thk-toolkit-panel .thk-modal-body','#thk-toolkit-panel .thk-modal-footer','#thk-toolkit-panel .thk-input-field','#thk-toolkit-panel .thk-btn-secondary'];
                    return selectors.map(selector=>{
                        const node=document.querySelector(selector);if(!node)throw Error('Missing '+selector);
                        const style=getComputedStyle(node);let parent=node,background='';
                        while(parent){background=getComputedStyle(parent).backgroundColor;if(background!=='rgba(0, 0, 0, 0)'&&background!=='transparent')break;parent=parent.parentElement;}
                        return {selector,text:style.color,background};
                    });
                })()`);
                for (const color of colors) assert.ok(contrast(color.text,color.background) >= 4.5,
                    `${platform}/${theme}: ${color.selector} contrast ${contrast(color.text,color.background).toFixed(2)} (${color.text} on ${color.background})`);
                assert.equal(await evaluate(`document.documentElement.dataset.thkPlatform`), platform === 'MacIntel' ? 'mac' : 'windows');
                // Primary actions need a distinct foreground in dark mode.
                const primary = await evaluate(`(() => {const b=document.createElement('button');b.className='thk-btn-primary';b.textContent='Save';document.querySelector('#thk-toolkit-panel .thk-modal-footer').append(b);const s=getComputedStyle(b);const result={text:s.color,background:s.backgroundColor};b.remove();return result;})()`);
                assert.ok(contrast(primary.text,primary.background)>=4.5, 'Primary action contrast');
                results.push({platform,theme,minimumContrast:Math.min(...colors.map(c=>contrast(c.text,c.background))).toFixed(2)});
                const screenshot = await send('Page.captureScreenshot', {format:'png'});
                const output = path.resolve(__dirname, '../target/diagnostics/theme-' + platform + '-' + theme + '.png');
                fs.writeFileSync(output, Buffer.from(screenshot.data,'base64'));
            }
        }
        assert.deepEqual(errors, [], 'No renderer errors');
        console.log(JSON.stringify({passed:true,engine:'Native WebView2',checks:results},null,2));
    } finally {
        await send('Fetch.disable');
        await send('Emulation.setEmulatedMedia', {features:[]});
        socket.close();
    }
})().catch(error => { console.error(error); process.exitCode=1; });
