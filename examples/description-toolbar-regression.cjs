// Run with: node examples/description-toolbar-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/injected.js'), 'utf8');

class Style {
    constructor(){this.values=new Map();this.priorities=new Map();}
    getPropertyValue(key){return this.values.get(key)||'';}
    getPropertyPriority(key){return this.priorities.get(key)||'';}
    setProperty(key,value,priority=''){this.values.set(key,value);this.priorities.set(key,priority);}
    removeProperty(key){this.values.delete(key);this.priorities.delete(key);}
}
class Node {
    constructor(tag, className = '') {
        this.tagName = tag.toUpperCase(); this.className = className; this.children = []; this.attrs = {}; this.listeners = {};
        this.style=new Style();this.scrollLeft=0;this.scrollTop=0;this.clientLeft=0;this.clientTop=0;
        this.value = ''; this.selectionStart = 0; this.selectionEnd = 0; this.events = []; this.text = '';
        this.classList = {
            contains: name => this.className.split(' ').includes(name),
            add: name => { if (!this.classList.contains(name)) this.className += ' ' + name; },
            remove: name => { this.className = this.className.split(' ').filter(item => item !== name).join(' '); }
        };
    }
    get parentElement() { return this.parentNode; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    appendChild(node) { node.remove(); this.children.push(node); node.parentNode = this; return node; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    before(node) { node.remove(); this.parentNode.children.splice(this.parentNode.children.indexOf(this), 0, node); node.parentNode = this.parentNode; }
    after(node) { node.remove(); this.parentNode.children.splice(this.parentNode.children.indexOf(this) + 1, 0, node); node.parentNode = this.parentNode; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    fire(type) { const event = {preventDefault() {this.prevented = true;}, stopPropagation() {}}; this.listeners[type]?.forEach(callback => callback(event)); return event; }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    dispatchEvent(event) { this.events.push(event.type); }
    getBoundingClientRect(){return this.tagName==='TEXTAREA'?{left:20,top:40,width:500,height:340}:this.classList.contains('thk-description-toolbar')?{left:20,top:40,width:500,height:38}:{left:0,top:0,width:700,height:500};}
    getClientRects() { return this.collapsed ? [] : [{}]; }
    matches(selector) { return selector.split(',').some(query => {
        query = query.trim();
        if (query.startsWith('#')) return this.id === query.slice(1);
        if (query.startsWith('.')) return query.slice(1).split('.').every(name => this.classList.contains(name));
        const labelledTag = query.match(/^([a-z]+)\[([a-z-]+)\]$/);
        if (labelledTag) return this.tagName === labelledTag[1].toUpperCase() && this.getAttribute(labelledTag[2]) !== null;
        const attr = query.match(/^\[([^=*]+)(\*)?(?:="([^"]*)")?\]$/);
        if (attr) {
            const value = attr[1] === 'class' ? this.className : this.getAttribute(attr[1]);
            return attr[3] === undefined ? value !== null : attr[2] ? value?.includes(attr[3]) : value === attr[3];
        }
        return this.tagName === query.toUpperCase();
    }); }
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
    querySelectorAll(selector) {
        const result = [];
        for (const child of this.children) {
            if (selector.split(',').some(query => {
                const parts = query.trim().split(/\s+/);
                return child.matches(parts.at(-1)) && (parts.length === 1 || child.parentNode?.closest(parts[0]));
            })) result.push(child);
            result.push(...child.querySelectorAll(selector));
        }
        return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const body = new Node('body');
const document = {body, activeElement: null, createElement: tag => new Node(tag), execCommand: () => false,
    querySelector: selector => body.querySelector(selector), querySelectorAll: selector => body.querySelectorAll(selector), getElementById: id => body.querySelector('#' + id)};
const composer = new Node('textarea'); composer.id = '_chatText'; composer.value = 'Unsent chat draft'; body.appendChild(composer);
const section = new Node('section', 'roomDescription'); body.appendChild(section);
const heading = new Node('div'); section.appendChild(heading);
const header = new Node('span', 'roomDescription__headerText'); header.textContent = 'Description'; heading.appendChild(header);
const inlineDescription = new Node('textarea'); section.appendChild(inlineDescription);
const context = vm.createContext({document, window: {__thkToolkit: {getLanguage: () => 'vi'}}, navigator: {language: 'vi'},
    getComputedStyle:node=>({position:node.style.getPropertyValue('position')||'static',boxSizing:'content-box',paddingTop:'8px'}),
    Event: class {constructor(type) {this.type = type;}}, WeakMap});
const helpers = source.slice(source.indexOf('    function getChatText()'), source.indexOf('    // ── 11.'));
const icons = source.slice(source.indexOf('    const formattingIcons'), source.indexOf('    function createToolbarElement'));
const toolbar = source.slice(source.indexOf('    const descriptionToolbars'), source.indexOf('    // ── 13.'));
vm.runInContext(helpers + '\nfunction openMarkdownPreviewModal() { globalThis.previewEditor = getFormattingEditor(); }\n' + icons + toolbar, context);
const setup = () => vm.runInContext('setupDescriptionToolbar()', context);
setup();
assert.equal(body.querySelector('.thk-description-toolbar'), null, 'The static sidebar description header does not get shortcuts');
const dialog = new Node('div'); body.appendChild(dialog);
const popupHeading = new Node('div'); dialog.appendChild(popupHeading);
const title = new Node('div', 'sc-iHmpnF eiYmEZ'); title.textContent = 'Chỉnh sửa mô tả'; popupHeading.appendChild(title);
const closeButton = new Node('button'); popupHeading.appendChild(closeButton);
const formBody = new Node('div'); dialog.appendChild(formBody);
let description = new Node('textarea'); formBody.appendChild(description);
const controls = () => dialog.querySelector('.thk-description-toolbar').children;
setup(); setup();
assert.equal(dialog.querySelectorAll('.thk-description-toolbar').length, 1, 'Observer passes do not duplicate the toolbar');
assert.equal(popupHeading.nextElementSibling.className, 'thk-description-toolbar', 'Toolbar is inside the popup below its title row');
assert.equal(popupHeading.nextElementSibling.nextElementSibling, formBody, 'Shortcuts appear above the popup input');
assert.equal(heading.querySelector('.thk-description-toolbar'), null, 'Popup shortcuts never attach to the sidebar header');
assert.equal(controls().map(node => node.title).join(','), 'Info,Tiêu đề,Code,Đường kẻ,Xem trước');
assert.ok(controls().every(node=>node.classList.contains('thk-icon-btn') && node.innerHTML.startsWith('<svg') && node.textContent === ''), 'Description shortcuts display the shared composer icons');
assert.equal(controls()[0].getAttribute('aria-label'), 'Info');
assert.equal(dialog.querySelector('.thk-description-toolbar').fire('mousedown').prevented, true, 'Mouse interaction preserves the textarea selection');
function click(index, text) {
    description.value = text; description.setSelectionRange(0, text.length);
    composer.focus(); controls()[index].focus(); controls()[index].fire('click');
    assert.equal(composer.value, 'Unsent chat draft', 'Description buttons never modify the chat composer');
}
click(0, 'Group description'); assert.equal(description.value, '[info]\nGroup description\n[/info]\n');
assert.ok(description.events.includes('input') && description.events.includes('change'));
click(1, 'Title body'); assert.ok(description.value.includes('[title]Tiêu đề[/title]\nTitle body'));
click(2, 'let x = 1;'); assert.equal(description.value, '[code]\nlet x = 1;\n[/code]\n');
click(3, ''); assert.equal(description.value, '[hr]\n');
click(4, 'Preview description'); assert.equal(context.previewEditor, description);
const oldEditor = description; oldEditor.remove(); description = new Node('textarea'); formBody.appendChild(description);
setup(); click(0, 'New editor'); assert.equal(description.value, '[info]\nNew editor\n[/info]\n');
assert.equal(oldEditor.value, 'Preview description', 'Rerendered editors replace the previous target');
description.readOnly = true; setup(); assert.equal(dialog.querySelector('.thk-description-toolbar'), null, 'Read-only description has no toolbar');
description.remove();
description = new Node('textarea'); formBody.appendChild(description);
setup(); click(2, 'Portal editor'); assert.equal(description.value, '[code]\nPortal editor\n[/code]\n', 'Popup rendered outside the sidebar is supported');
const staleControl = controls()[0];
dialog.remove(); setup(); assert.equal(body.querySelector('.thk-description-toolbar'), null, 'Closing the popup removes its shortcuts');
staleControl.fire('click'); assert.equal(composer.value, 'Unsent chat draft', 'A closed popup cannot redirect formatting into chat');
title.textContent = 'Create task'; body.appendChild(dialog); setup();
assert.equal(body.querySelector('.thk-description-toolbar'), null, 'Unrelated dialogs are ignored');
dialog.remove(); body.appendChild(dialog); title.textContent = 'Update group description'; description.collapsed = true; setup();
assert.equal(body.querySelector('.thk-description-toolbar'), null, 'Hidden editor cannot receive formatting');
description.collapsed = false; title.className = ''; title.tagName = 'H2'; setup();
assert.ok(dialog.querySelector('.thk-description-toolbar'), 'Semantic popup titles work when generated class names change');
dialog.remove();setup();
const modalRoot=new Node('div');modalRoot.id='RootModalsEntryPoint';body.appendChild(modalRoot);
const groupDialog=new Node('div');groupDialog.setAttribute('role','dialog');modalRoot.appendChild(groupDialog);
const settingsHeading=new Node('h2');settingsHeading.textContent='Cài đặt Trò chuyện Nhóm';groupDialog.appendChild(settingsHeading);
const groupName=new Node('input');groupName.value='Keep group name';groupDialog.appendChild(groupName);
const descriptionRow=new Node('div');groupDialog.appendChild(descriptionRow);
const descriptionLabel=new Node('label');descriptionLabel.textContent='Mô tả:';descriptionLabel.setAttribute('for','group-description');descriptionRow.appendChild(descriptionLabel);
const groupDescription=new Node('textarea');groupDescription.id='group-description';descriptionRow.appendChild(groupDescription);
const notesRow=new Node('div');groupDialog.appendChild(notesRow);
const notesLabel=new Node('label');notesLabel.textContent='Notes';notesRow.appendChild(notesLabel);
const notesEditor=new Node('textarea');notesEditor.value='Keep notes';notesRow.appendChild(notesEditor);
setup();setup();
assert.equal(groupDialog.querySelectorAll('.thk-description-toolbar').length,1,'Group Chat Settings has one description toolbar even with other editors');
assert.ok(descriptionLabel.nextElementSibling.classList.contains('thk-description-toolbar'));
assert.equal(descriptionLabel.nextElementSibling.nextElementSibling,groupDescription,'Shortcuts are immediately above the description textarea');
assert.equal(notesRow.querySelector('.thk-description-toolbar'),null,'Other settings fields do not receive description shortcuts');
assert.ok(descriptionRow.querySelector('.thk-description-toolbar').classList.contains('thk-description-field-toolbar'),'Settings shortcuts overlay the description field instead of adding a form row');
assert.equal(groupDescription.style.getPropertyValue('height'),'340px','Native field outer height is preserved');
assert.equal(groupDescription.style.getPropertyValue('padding-top'),'46px');
setup();assert.equal(groupDescription.style.getPropertyValue('padding-top'),'46px','Repeated passes never accumulate toolbar padding');
const settingsControls=()=>descriptionRow.querySelector('.thk-description-toolbar').children;
for(const [index,initial,expected] of [[0,'Description','[info]'],[1,'Body','[title]'],[2,'let a = 1;','[code]'],[3,'','[hr]']]) {
    groupDescription.value=initial;groupDescription.setSelectionRange(0,initial.length);composer.focus();settingsControls()[index].fire('click');
    assert.ok(groupDescription.value.includes(expected));assert.equal(groupName.value,'Keep group name');assert.equal(notesEditor.value,'Keep notes');assert.equal(composer.value,'Unsent chat draft');
}
settingsControls()[4].fire('click');assert.equal(context.previewEditor,groupDescription);
// Native group settings may use an unassociated caption instead of label/for.
descriptionLabel.remove();const caption=new Node('span');caption.textContent='Mô tả:';descriptionRow.appendChild(caption);groupDescription.id='';setup();
assert.equal(groupDialog.querySelectorAll('.thk-description-toolbar').length,1,'Decomposed Vietnamese captions identify an unlabelled group description');
groupDescription.readOnly=true;setup();assert.equal(descriptionRow.querySelector('.thk-description-toolbar'),null);
assert.equal(groupDescription.style.getPropertyValue('height'),'');assert.equal(groupDescription.style.getPropertyValue('padding-top'),'');
assert.equal(descriptionRow.style.getPropertyValue('position'),'','Removing shortcuts restores native layout');
groupDescription.readOnly=false;setup();const staleSettingsControl=settingsControls()[0];
modalRoot.remove();setup();staleSettingsControl.fire('click');assert.equal(composer.value,'Unsent chat draft','Closing group settings cannot redirect formatting into chat');
console.log('Description and Group Chat Settings toolbars, formatting targets, Unicode labels and popup lifecycle checks passed.');
