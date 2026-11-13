// Run after a Universal build: node examples/mac-bundle-regression.cjs path/to/THK-Chat.app
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const bundle=path.resolve(process.argv[2] || '');
assert.ok(process.argv[2] && bundle.endsWith('.app'),'Provide a built macOS app bundle');
const scripts=['injected.js','toolkit.js','room-folders.js','downloads.js','files.js','file-preview.js','update-ui.js'];
const text=file=>fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
const swift=text(path.join(root,'mac/Native/main.swift'));
const runtimeScripts=[...swift.match(/for file in \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map(match=>match[1]);
assert.deepEqual(runtimeScripts,scripts,'Swift initializes every shared web module in order');
for(const name of [...scripts,'ui.css']) {
    const packaged=text(path.join(bundle,'Contents/Resources',name));
    assert.equal(packaged,text(path.join(root,'src',name)),'Packaged resource matches current source: '+name);
    if(name.endsWith('.js'))new vm.Script(packaged,{filename:name});
}
assert.equal(text(path.join(bundle,'Contents/Resources/icon.svg')),text(path.join(root,'assets/branding/icon.svg')));
assert.equal(text(path.join(bundle,'Contents/Resources/macos-update.sh')),text(path.join(root,'ota/macos-update.sh')));
const plist=text(path.join(bundle,'Contents/Info.plist'));
const field=key=>plist.match(new RegExp('<key>'+key+'</key>\\s*<string>([^<]+)</string>'))?.[1];
const version=text(path.join(root,'Cargo.toml')).match(/^version\s*=\s*"([^"]+)"/m)[1];
assert.equal(field('CFBundleIdentifier'),'com.thk.chat');
assert.equal(field('CFBundleExecutable'),'chatwork');
assert.equal(field('CFBundleShortVersionString'),version);
assert.equal(field('CFBundleVersion'),version);
assert.equal(field('LSMinimumSystemVersion'),'12.0');
const executable=path.join(bundle,'Contents/MacOS/chatwork');
const binary=fs.readFileSync(executable),magic=binary.readUInt32BE(0);
assert.ok([0xcafebabe,0xcafebabf].includes(magic),'Expected Universal Mach-O executable');
const count=binary.readUInt32BE(4),stride=magic===0xcafebabf?32:20;
const types=Array.from({length:count},(_,index)=>binary.readUInt32BE(8+index*stride));
assert.ok(types.includes(0x0100000c),'Apple Silicon arm64 slice is present');
assert.ok(types.includes(0x01000007),'Intel x86_64 slice is present');
if(process.platform!=='win32')assert.ok(fs.statSync(executable).mode & 0o111,'Bundle executable retains execute permission');
console.log(`macOS ${version} Universal bundle, all runtime scripts, updater and branding verified.`);
