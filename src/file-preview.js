(() => {
    'use strict';
    const MB = 1024 * 1024;
    const words = {
        vi:{preview:'Xem trước',back:'Quay lại danh sách',download:'Tải xuống',loading:'Đang tải bản xem trước…',unsupported:'Chưa hỗ trợ xem trước định dạng này. Bạn có thể tải file để mở.',failed:'Không mở được bản xem trước. File có thể đã hết quyền truy cập hoặc dùng định dạng chưa hỗ trợ.',large:'File quá lớn để xem trước trong app. Vui lòng tải xuống để mở.',basic:'Bản xem trước nội dung; bố cục và định dạng có thể khác file gốc.',sheet:'Trang tính',slide:'Slide',limit:'Hiển thị tối đa 200 dòng và 50 cột cho mỗi trang tính.',empty:'Không có nội dung văn bản để hiển thị.'},
        en:{preview:'Preview',back:'Back to files',download:'Download',loading:'Loading preview…',unsupported:'Preview is not available for this format. Download the file to open it.',failed:'Could not open the preview. Access may have expired or the format may be unsupported.',large:'This file is too large for an in-app preview. Download it to open it.',basic:'Content preview; layout and formatting may differ from the original file.',sheet:'Worksheet',slide:'Slide',limit:'Showing up to 200 rows and 50 columns per worksheet.',empty:'No text content to display.'},
        ja:{preview:'プレビュー',back:'一覧に戻る',download:'ダウンロード',loading:'プレビューを読み込み中…',unsupported:'この形式はプレビューできません。ダウンロードして開いてください。',failed:'プレビューを開けませんでした。権限またはファイル形式をご確認ください。',large:'アプリ内で表示するには大きすぎます。ダウンロードしてください。',basic:'内容のプレビューです。レイアウトや書式は元のファイルと異なる場合があります。',sheet:'シート',slide:'スライド',limit:'各シート最大200行・50列を表示します。',empty:'表示するテキストがありません。'}
    };
    const t = key => words[window.__thkToolkit?.getLanguage?.() || 'en'][key];
    const extension = file => file.name.split('.').pop().toLowerCase();
    function kind(file) {
        const ext = extension(file);
        if (file.category === 'image') return 'image';
        if (file.category === 'video') return 'video';
        if (ext === 'pdf' || file.mime === 'application/pdf') return 'pdf';
        if (['docx','xlsx','pptx'].includes(ext)) return ext;
        if (/^(txt|md|csv|json|log|xml|yaml|yml|html?|css|js|ts|jsx|tsx|rs|py|sql|ini|toml)$/.test(ext) || /^text\//.test(file.mime || '')) return 'text';
        return 'unsupported';
    }
    async function readStream(stream, limit, signal) {
        const reader = stream.getReader(); const chunks=[]; let bytes=0;
        const abort = () => { reader.cancel().catch(()=>{}); };
        signal?.addEventListener('abort',abort,{once:true});
        try {
            while (true) {
                if (signal?.aborted) throw new DOMException('Aborted','AbortError');
                const part=await reader.read(); if (part.done) break;
                bytes+=part.value.byteLength;
                if (bytes>limit) throw new Error(t('large'));
                chunks.push(part.value);
            }
            if (signal?.aborted) throw new DOMException('Aborted','AbortError');
            return new Blob(chunks);
        } finally { signal?.removeEventListener('abort',abort); reader.cancel().catch(()=>{}); reader.releaseLock(); }
    }
    async function fetchBlob(file, type, signal) {
        const limit = type==='text' ? 2*MB : ['docx','xlsx','pptx'].includes(type) ? 25*MB : 64*MB;
        if (file.size>limit) throw new Error(t('large'));
        let error;
        for (const url of window.__thkFiles.previewUrls(file)) {
            try {
                const response=await fetch(url,{credentials:'include',signal});
                if (!response.ok) throw new Error(t('failed'));
                if (type!=='text' && /text\/html/i.test(response.headers.get('Content-Type') || '')) { await response.body?.cancel(); throw new Error(t('failed')); }
                if (Number(response.headers.get('Content-Length'))>limit) { await response.body?.cancel(); throw new Error(t('large')); }
                if (response.body?.getReader) return await readStream(response.body,limit,signal);
                const blob=await response.blob(); if (blob.size>limit) throw new Error(t('large')); return blob;
            } catch(e) { if (signal.aborted) throw e; error=e; }
        }
        throw error || new Error(t('failed'));
    }
    function xml(text) {
        if (/<!DOCTYPE/i.test(text)) throw new Error(t('failed'));
        const doc=new DOMParser().parseFromString(text,'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error(t('failed'));
        return doc;
    }
    const nodes = (root,name) => [...root.getElementsByTagNameNS('*',name)];
    // Read only bounded XML entries in memory. No archive files are extracted.
    async function officeArchive(blob, signal) {
        const bytes=new Uint8Array(await blob.arrayBuffer()), view=new DataView(bytes.buffer), entries=new Map();
        let end=bytes.length-22;
        while(end>=Math.max(0,bytes.length-65557)&&view.getUint32(end,true)!==0x06054b50)end--;
        if(end<0)throw new Error(t('failed'));
        const count=view.getUint16(end+10,true); if(count>10000)throw new Error(t('large'));
        let offset=view.getUint32(end+16,true);
        for(let i=0;i<count;i++) {
            if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw new Error(t('failed'));
            const length=view.getUint16(offset+28,true), extra=view.getUint16(offset+30,true), comment=view.getUint16(offset+32,true);
            const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+length));
            entries.set(name,{method:view.getUint16(offset+10,true),flags:view.getUint16(offset+8,true),compressed:view.getUint32(offset+20,true),size:view.getUint32(offset+24,true),local:view.getUint32(offset+42,true)});
            offset+=46+length+extra+comment;
        }
        return {
            names:[...entries.keys()],
            async read(name,optional=false) {
                if(signal.aborted)throw new DOMException('Aborted','AbortError');
                const entry=entries.get(name); if(!entry){if(optional)return null;throw new Error(t('failed'));}
                if(entry.size>4*MB||entry.compressed>25*MB)throw new Error(t('large'));
                if(entry.flags&1||![0,8].includes(entry.method)||entry.local+30>bytes.length||view.getUint32(entry.local,true)!==0x04034b50)throw new Error(t('unsupported'));
                const start=entry.local+30+view.getUint16(entry.local+26,true)+view.getUint16(entry.local+28,true);
                if(start+entry.compressed>bytes.length)throw new Error(t('failed'));
                let data=new Blob([bytes.subarray(start,start+entry.compressed)]);
                if(entry.method===8) {
                    if(typeof DecompressionStream==='undefined')throw new Error(t('unsupported'));
                    data=await readStream(data.stream().pipeThrough(new DecompressionStream('deflate-raw')),4*MB,signal);
                }
                if(data.size!==entry.size)throw new Error(t('failed'));
                return xml(await data.text());
            }
        };
    }
    function open(file, options) {
        const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
        const controller=new AbortController(), urls=[], cleaners=[];
        let disposed=false;
        const section=make('section','thk-file-preview-pane');
        const header=make('div','thk-file-preview-header');
        const back=make('button','thk-btn-secondary',t('back'));back.type='button';header.appendChild(back);
        const download=make('button','thk-btn-primary',t('download'));download.type='button';download.addEventListener('click',()=>{if(options.isCurrent())window.__thk_startDownload?.(window.__thkFiles.downloadUrl(file),file.name);});header.appendChild(download);section.appendChild(header);
        section.appendChild(make('h3','thk-file-preview-name',file.name));
        const status=make('p','thk-leave-hint',t('loading'));status.setAttribute('role','status');section.appendChild(status);
        const content=make('div','thk-file-preview-content');section.appendChild(content);options.body.appendChild(section);
        const alive=()=>!disposed&&options.isCurrent();
        function dispose(){if(disposed)return;disposed=true;controller.abort();cleaners.forEach(fn=>fn());urls.forEach(url=>URL.revokeObjectURL(url));section.remove();}
        back.addEventListener('click',()=>{dispose();options.onBack();});back.focus();
        const objectUrl=(blob,mime)=>{const url=URL.createObjectURL(new Blob([blob],{type:mime}));urls.push(url);return url;};
        const fail=error=>{if(alive())status.textContent=[t('failed'),t('large'),t('unsupported')].includes(error?.message)?error.message:t('failed');};
        const media=(tag,src,onError)=>{
            const el=make(tag,'thk-file-preview-media');
            if(tag==='video'){el.controls=true;el.preload='metadata';cleaners.push(()=>{el.pause();el.removeAttribute('src');el.load();});}
            else el.alt=file.name;
            el.addEventListener(tag==='video'?'loadedmetadata':'load',()=>{if(alive())status.textContent='';});
            el.addEventListener('error',()=>{if(alive()){if(onError)onError(el);else fail(new Error(t('failed')));}});el.src=src;content.appendChild(el);return el;
        };
        async function renderOffice(blob,type){
            const archive=await officeArchive(blob,controller.signal);
            if(!alive())return;
            status.textContent=t('basic');
            if(type==='docx'){
                const doc=await archive.read('word/document.xml');if(!alive())return;
                const text=nodes(doc,'p').slice(0,2000).map(p=>nodes(p,'t').map(t=>t.textContent).join('')).join('\n');
                content.appendChild(make('pre','thk-file-preview-text',text||t('empty')));
            } else if(type==='pptx'){
                const names=archive.names.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)[1])-Number(b.match(/slide(\d+)/)[1])).slice(0,50);
                for(const [index,name] of names.entries()){
                    const doc=await archive.read(name);if(!alive())return;
                    content.appendChild(make('h4','',`${t('slide')} ${index+1}`));content.appendChild(make('pre','thk-file-preview-text',nodes(doc,'p').map(p=>nodes(p,'t').map(t=>t.textContent).join('')).join('\n')||t('empty')));
                }
            } else {
                const book=await archive.read('xl/workbook.xml'), rels=await archive.read('xl/_rels/workbook.xml.rels'), strings=await archive.read('xl/sharedStrings.xml',true);
                if(!alive())return;
                const shared=strings?nodes(strings,'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')):[];
                const relationships=new Map(nodes(rels,'Relationship').filter(r=>r.getAttribute('TargetMode')!=='External').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
                const sheets=nodes(book,'sheet').map(s=>({name:s.getAttribute('name'),target:relationships.get(s.getAttribute('r:id')||s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'))})).filter(s=>s.target);
                const select=make('select','thk-input-field');select.setAttribute('aria-label',t('sheet'));sheets.forEach((s,i)=>{const option=make('option','',s.name);option.value=String(i);select.appendChild(option);});content.appendChild(select);
                content.appendChild(make('p','thk-leave-hint',t('limit')));const tableBox=make('div','thk-file-preview-table');content.appendChild(tableBox);
                let generation=0;
                async function drawSheet(){
                    const current=++generation,sheet=sheets[Number(select.value)||0];if(!sheet)return;
                    const name=sheet.target.startsWith('/')?sheet.target.slice(1):'xl/'+sheet.target.replace(/^\.\//,'');
                    if(!/^xl\/worksheets\/[\w.-]+\.xml$/.test(name))throw new Error(t('unsupported'));
                    const doc=await archive.read(name);if(!alive()||current!==generation)return;
                    const table=make('table');
                    nodes(doc,'row').slice(0,200).forEach(row=>{
                        const tr=make('tr');let column=0;
                        for(const cell of nodes(row,'c')){
                            const letters=(cell.getAttribute('r')||'').match(/^[A-Z]+/)?.[0]||'';let index=0;for(const letter of letters)index=index*26+letter.charCodeAt(0)-64;index=index?index-1:column;
                            if(index>=50)break;while(column<index){tr.appendChild(make('td'));column++;}
                            const raw=nodes(cell,'v')[0]?.textContent||'',type=cell.getAttribute('t');
                            const text=type==='s'?shared[Number(raw)]||'':type==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):type==='b'?(raw==='1'?'TRUE':'FALSE'):raw;
                            tr.appendChild(make('td','',text));column++;
                        }
                        table.appendChild(tr);
                    });tableBox.replaceChildren(table);
                }
                select.addEventListener('change',()=>drawSheet().catch(fail));await drawSheet();
            }
        }
        (async()=>{
            const type=kind(file);
            if(type==='unsupported'){status.textContent=t('unsupported');return;}
            if(type==='video'){
                let retried=false;
                media('video',window.__thkFiles.previewUrls(file)[0],async player=>{
                    if(retried){fail(new Error(t('failed')));return;}retried=true;
                    try{const blob=await fetchBlob(file,'video',controller.signal);if(alive())player.src=objectUrl(blob,file.mime||'video/mp4');}catch(error){if(error.name!=='AbortError')fail(error);}
                });return;
            }
            let blob;
            try{blob=await fetchBlob(file,type,controller.signal);}catch(error){if(type==='image'&&alive()){media('img',window.__thkFiles.previewUrls(file)[0]);return;}throw error;}
            if(!alive())return;
            if(type==='image'){media('img',objectUrl(blob,file.mime?.startsWith('image/')?file.mime:'image/'+(extension(file)==='svg'?'svg+xml':extension(file)==='jpg'?'jpeg':extension(file))));}
            else if(type==='pdf'){
                if(!(await blob.slice(0,1024).text()).includes('%PDF-'))throw new Error(t('failed'));
                if(!alive())return;
                // PDF plugins are disabled in sandboxed frames. Only a validated PDF
                // blob is embedded here; HTML and other text are rendered as plain text.
                const frame=make('iframe','thk-file-preview-pdf');frame.title=file.name;frame.src=objectUrl(blob,'application/pdf');frame.addEventListener('load',()=>{if(alive())status.textContent='';});content.appendChild(frame);
            }else if(type==='text'){status.textContent='';content.appendChild(make('pre','thk-file-preview-text',await blob.text()));}
            else await renderOffice(blob,type);
        })().catch(error=>{if(error.name!=='AbortError')fail(error);});
        return dispose;
    }
    window.__thkFilePreview={open,kind,readStream,officeArchive};
})();
