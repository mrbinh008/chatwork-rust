// Run with: node examples/branding-regression.cjs
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ico=fs.readFileSync(path.join(root,'assets/thk.ico'));
assert.equal(ico.readUInt16LE(2),1);assert.equal(ico.readUInt16LE(4),6);
for(let index=0;index<6;index++){const row=6+index*16,offset=ico.readUInt32LE(row+12),size=ico.readUInt32LE(row+8);assert.ok(offset+size<=ico.length);assert.equal(ico.toString('ascii',offset+1,offset+4),'PNG');}
const icns=fs.readFileSync(path.join(root,'assets/AppIcon.icns'));assert.equal(icns.toString('ascii',0,4),'icns');assert.equal(icns.readUInt32BE(4),icns.length);
let offset=8;const types=[];while(offset<icns.length){const type=icns.toString('ascii',offset,offset+4),length=icns.readUInt32BE(offset+4);assert.ok(length>8&&offset+length<=icns.length);assert.equal(icns.toString('ascii',offset+9,offset+12),'PNG');types.push(type);offset+=length;}assert.equal(offset,icns.length);assert.ok(types.includes('ic10'));
for(const size of [16,32]){const rgba=fs.readFileSync(path.join(root,'assets/thk_'+size+'.rgba'));assert.equal(rgba.length,size*size*4);let red=0,transparent=0;for(let index=0;index<rgba.length;index+=4){if(rgba[index]>150&&rgba[index+1]<120&&rgba[index+2]<120&&rgba[index+3]>0)red++;if(rgba[index+3]===0)transparent++;}assert.ok(red>size);assert.ok(transparent>0);}
for(const variant of ['thk_signature', 'thk_dog']){
    for(const size of [16,32]){
        const rgba=fs.readFileSync(path.join(root,'assets/'+variant+'_'+size+'.rgba'));
        assert.equal(rgba.length,size*size*4, variant + ' ' + size + ' rgba has exact dimensions');
    }
}
for(const svgName of ['icon.svg', 'icon-original.svg', 'icon-signature.svg', 'icon-dog.svg']){
    const svg=fs.readFileSync(path.join(root,'assets/branding',svgName),'utf8');
    assert.ok(svg.startsWith('<svg') && svg.includes('</svg>'), svgName+' is a valid SVG');
}
const app=fs.readFileSync(path.join(root,'src/app.rs'),'utf8');assert.ok(app.includes('APP_NAME: &str = "THK-Chat"'));
const plist=fs.readFileSync(path.join(root,'mac/Info.plist'),'utf8');assert.ok(plist.includes('<string>THK-Chat</string>'));assert.ok(plist.includes('<string>com.thk.chat</string>'));
const installer=fs.readFileSync(path.join(root,'installer.nsi'),'utf8');assert.ok(installer.includes('Name "THK-Chat"'));assert.ok(installer.includes('/oname=THK-Chat.exe'));
const iconSizes={icp4:16,icp5:32,icp6:64,ic07:128,ic08:256,ic09:512,ic10:1024};
let iconOffset=8;
while(iconOffset<icns.length){
    const kind=icns.toString('ascii',iconOffset,iconOffset+4),length=icns.readUInt32BE(iconOffset+4),size=iconSizes[kind];
    if(size)assert.deepEqual(icns.subarray(iconOffset+8,iconOffset+length),fs.readFileSync(path.join(root,'THK-Chat-Logo-Pack','original-'+size+'.png')),'macOS icon matches the current logo at '+size+'px');
    iconOffset+=length;
}
assert.deepEqual(fs.readFileSync(path.join(root,'assets/thk.png')),fs.readFileSync(path.join(root,'THK-Chat-Logo-Pack/original-512.png')));
assert.ok(/<key>CFBundleIconFile<\/key>\s*<string>AppIcon.icns<\/string>/.test(plist),'The notification app bundle points to the current icon');
console.log('THK-Chat native icon formats, current logo pixels and notification bundle icon checks passed.');
