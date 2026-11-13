// Convert the supplied THK-Chat Original PNG assets into native icon containers.
// Run with: node examples/sync-brand-assets.cjs
const fs=require('node:fs');const path=require('node:path');const zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');const pack=path.join(root,'THK-Chat-Logo-Pack');const assets=path.join(root,'assets');
function decodeRGBA(png,expected){
 let offset=8,parts=[],width,height;
 while(offset<png.length){const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);
 if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);if(data[8]!==8||data[9]!==6||data[12]!==0)throw Error('Expected non-interlaced 8-bit RGBA PNG');}
 if(type==='IDAT')parts.push(data);offset+=12+length;}
 if(width!==expected||height!==expected)throw Error('Unexpected image dimensions');
 const stride=width*4,raw=zlib.inflateSync(Buffer.concat(parts)),rgba=Buffer.alloc(stride*height);
 if(raw.length!==(stride+1)*height)throw Error('Unexpected PNG data length');
 function paeth(a,b,c){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const index=y*stride+x,a=x>=4?rgba[index-4]:0,b=y?rgba[index-stride]:0,c=y&&x>=4?rgba[index-stride-4]:0;let prediction=0;
 if(filter===1)prediction=a;else if(filter===2)prediction=b;else if(filter===3)prediction=Math.floor((a+b)/2);else if(filter===4)prediction=paeth(a,b,c);else if(filter!==0)throw Error('Unknown PNG filter');rgba[index]=(raw[y*(stride+1)+1+x]+prediction)&255;}}
 return rgba;
}
const sizes=[16,32,48,64,128,256];const pngs=sizes.map(size=>fs.readFileSync(path.join(pack,'original-'+size+'.png')));
const header=Buffer.alloc(6+sizes.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;
sizes.forEach((size,index)=>{const row=6+index*16;header[row]=size===256?0:size;header[row+1]=size===256?0:size;header.writeUInt16LE(1,row+4);header.writeUInt16LE(32,row+6);header.writeUInt32LE(pngs[index].length,row+8);header.writeUInt32LE(offset,row+12);offset+=pngs[index].length;});
fs.writeFileSync(path.join(assets,'thk.ico'),Buffer.concat([header,...pngs]));
for(const size of [16,32]) {
    fs.writeFileSync(path.join(assets,'thk_'+size+'.rgba'),decodeRGBA(fs.readFileSync(path.join(pack,'original-'+size+'.png')),size));
    fs.writeFileSync(path.join(assets,'thk_signature_'+size+'.rgba'),decodeRGBA(fs.readFileSync(path.join(pack,'thk-signature-'+size+'.png')),size));
    fs.writeFileSync(path.join(assets,'thk_dog_'+size+'.rgba'),decodeRGBA(fs.readFileSync(path.join(pack,'dog-original-'+size+'.png')),size));
}
fs.copyFileSync(path.join(pack,'original-512.png'),path.join(assets,'thk.png'));
const chunks=[['icp4',16],['icp5',32],['icp6',64],['ic07',128],['ic08',256],['ic09',512],['ic10',1024]].map(([type,size])=>{const png=fs.readFileSync(path.join(pack,'original-'+size+'.png'));const chunk=Buffer.alloc(8);chunk.write(type,0,4,'ascii');chunk.writeUInt32BE(png.length+8,4);return Buffer.concat([chunk,png]);});
const icns=Buffer.alloc(8);icns.write('icns');icns.writeUInt32BE(8+chunks.reduce((sum,chunk)=>sum+chunk.length,0),4);fs.writeFileSync(path.join(assets,'AppIcon.icns'),Buffer.concat([icns,...chunks]));
const branding=path.join(assets,'branding');fs.mkdirSync(branding,{recursive:true});
fs.copyFileSync(path.join(pack,'icon-original.svg'),path.join(branding,'icon.svg'));
fs.copyFileSync(path.join(pack,'icon-original.svg'),path.join(branding,'icon-original.svg'));
fs.copyFileSync(path.join(pack,'icon-thk-signature.svg'),path.join(branding,'icon-signature.svg'));
const dogPng128=fs.readFileSync(path.join(pack,'dog-original-128.png')).toString('base64');
const dogSvg='<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image href="data:image/png;base64,'+dogPng128+'" width="512" height="512" preserveAspectRatio="xMidYMid meet"/></svg>';
fs.writeFileSync(path.join(pack,'icon-dog.svg'),dogSvg);
fs.writeFileSync(path.join(branding,'icon-dog.svg'),dogSvg);
for(const [source,dest] of [['logo-horizontal-original-transparent.png','logo-light.png'],['logo-horizontal-original-dark.png','logo-dark.png'],['logo-horizontal-original-transparent.svg','logo-light.svg'],['logo-horizontal-original-dark.svg','logo-dark.svg']])fs.copyFileSync(path.join(pack,source),path.join(branding,dest));
console.log('THK-Chat icons synchronized: Windows ICO, window/tray RGBA, macOS ICNS and horizontal logos.');
