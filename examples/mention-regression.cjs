// Run with: node examples/mention-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/injected.js'), 'utf8');
new vm.Script(source);
class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase(); this.children = []; this.style = {};
        this.attrs = {}; this.className = ''; this.isConnected = true;
        this.classList = { toggle: (name, on) => { this.attrs[name] = on; }, add: name => { this.attrs[name] = true; } };
    }
    append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
    appendChild(node) {
        node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
        this.children.push(node); node.parentNode = this; return node;
    }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    set innerHTML(value) { this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener() {}
    scrollIntoView() {}
    matches(query) { return query.split(', ').some(s => s.toUpperCase() === this.tagName); }
    querySelector() { return null; }
}
const editor = {
    value: '', selectionStart: 0, selectionEnd: 0,
    focus() { document.activeElement = this; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    dispatchEvent() {},
    getBoundingClientRect() { return { left: 40, top: 400, width: 600 }; }
};
let toolbar = null;
let legacyEditor = true;
let modernRoom = null;
const document = {
    body: new Element('body'), activeElement: editor,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '#_chatText' ? (legacyEditor ? editor : null) : selector === '#CurrentSelectedRoom textarea' ? editor : toolbar,
    querySelectorAll: () => [],
    getElementById: id => id === 'CurrentSelectedRoom' ? modernRoom : document.body.children.flatMap(el => [el, ...el.children]).find(el => el.id === id) || null,
    execCommand: () => false
};
const window = {
    location: { hash: '#!rid1' }, innerHeight: 800,
    RM: { getMemberList: rid => rid === '1' ? ['10', '11'] : ['12'] },
    AC: { account_dat: {
        10: { name: 'Nguyễn Văn An' }, 11: { name: '<b>Đặng Bình</b>' },
        12: { name: 'Phòng khác' }
    } }
};
const context = vm.createContext({ window, document, Event: class {}, console, Map, Set });
const inputHelpers = source.slice(source.indexOf('    function getChatText()'), source.indexOf('    // [info] tag'));
const mentions = source.slice(source.indexOf('    function normalizeSearch'), source.indexOf('    // ── 12.'));
const setup = source.slice(source.indexOf('    function setupQuickToolbar()'), source.indexOf('    // ── 13.'));
vm.runInContext(inputHelpers + mentions + setup + String.raw`
    function createToolbarElement(isLi) {
        const el = document.createElement(isLi ? 'li' : 'div');
        el.id = 'thk-toolbar-inline'; return el;
    }
    globalThis.api = { getChatText, getRoomMembers, getTaggedMemberIds, checkMentionTrigger, selectMentionItem,
        closeMentionDropdown, setupQuickToolbar, state: () => ({ mentionDropdownEl, mentionFilteredList, mentionActiveIndex }) };
`, context);
const api = context.api;
function type(value, caret = value.length) {
    editor.value = value; editor.selectionStart = editor.selectionEnd = caret;
    api.checkMentionTrigger(); return api.state();
}
assert.equal(api.getRoomMembers().length, 2, 'Only current room members');
assert.equal(type('@nguyen van').mentionFilteredList[0].id, '10', 'Multiword Vietnamese search without accents');
api.selectMentionItem(api.state().mentionFilteredList[0]);
assert.equal(editor.value, '[To:10] Nguyễn Văn An\n');
assert.equal(editor.selectionStart, editor.value.length);
let state = type(editor.value + '@an');
assert.equal(state.mentionDropdownEl.children[0].attrs.tagged, true, 'Existing mention is marked');
assert.equal(state.mentionDropdownEl.children[0].children[2].textContent, '✓ Đã tag');
state = type('@an');
assert.equal(state.mentionDropdownEl.children[0].attrs.tagged, false, 'Deleted mention is unmarked');
assert.equal(type('mail@example.com').mentionDropdownEl, null, 'Email does not trigger');
assert.equal(type('@an\ntext').mentionDropdownEl, null, 'Do not cross newline');
assert.equal(type('@Đặng Bình').mentionFilteredList[0].id, '11');
state = type('@dang');
assert.equal(state.mentionDropdownEl.children[0].children[1].children[0].textContent, '<b>Đặng Bình</b>', 'Name rendered as text');
state = type('Hello @an rest', 9);
api.selectMentionItem(state.mentionFilteredList[0]);
assert.equal(editor.value, 'Hello [To:10] Nguyễn Văn An\n rest', 'Preserve text after caret');
assert.equal(type('@tat ca').mentionFilteredList[0].id, 'all');
api.selectMentionItem(api.state().mentionFilteredList[0]);
assert.equal(editor.value, '[To:all] ALL\n');
assert.equal(type(editor.value + '@all').mentionDropdownEl.children[0].attrs.tagged, true);
type('@an'); window.location.hash = '#!rid2'; api.selectMentionItem({ id: '10', name: 'An' });
assert.equal(editor.value, '@an', 'Stale room selection must not insert');
assert.equal(api.getRoomMembers()[0].id, '12');
window.location.hash = '#!rid1';
window.RM.getMemberList = () => Array.from({ length: 2000 }, (_, i) => String(i + 100));
for (let i = 100; i < 2100; i++) window.AC.account_dat[i] = { name: 'Thành viên ' + i };
assert.equal(type('@thanh vien 2099').mentionFilteredList[0].id, '2099', 'Find member beyond first page');
api.setupQuickToolbar();
assert.equal(document.getElementById('thk-toolbar-inline'), null, 'Wait for toolbar without standalone fallback');
toolbar = new Element('ul'); document.body.append(toolbar);
api.setupQuickToolbar(); api.setupQuickToolbar();
assert.equal(toolbar.children.length, 1, 'No duplicate toolbar');
assert.equal(toolbar.children[0].tagName, 'LI');
const oldToolbar = toolbar;
toolbar = new Element('div'); document.body.append(toolbar);
api.setupQuickToolbar();
assert.equal(oldToolbar.children.length, 0, 'Move from old toolbar');
assert.equal(toolbar.children.length, 1);
assert.equal(toolbar.children[0].tagName, 'DIV');
// Current Chatwork has no legacy textarea ID or toolbar class.
legacyEditor = false;
assert.equal(api.getChatText(), editor);
toolbar = null;
const modernList = new Element('ul'); document.body.append(modernList);
modernRoom = { querySelectorAll: () => [{ getAttribute: () => 'Emoji : Thể hiện bản thân', closest: () => modernList }] };
api.setupQuickToolbar();
assert.equal(modernList.children.length, 1, 'Attach to modern native emoji toolbar');
assert.equal(modernList.children[0].id, 'thk-toolbar-inline');
console.log('Mention and toolbar regression checks passed.');
