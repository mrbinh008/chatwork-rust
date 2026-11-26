// Run with: node examples/request-navigation-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class TestEvent {
    constructor(type, options = {}) { this.type = type; this.cancelable = options.cancelable; this.defaultPrevented = false; }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}
class TestEventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, callback) { const list = this.listeners.get(name) || new Set(); list.add(callback); this.listeners.set(name, list); }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    dispatchEvent(event) { this.listeners.get(event.type)?.forEach(callback => callback(event)); return !event.defaultPrevented; }
}
const source = fs.readFileSync(path.join(__dirname, '../src/injected.js'), 'utf8');
new vm.Script(source);
const miniAppIpcMessages = [];
const openedPopups = [];
let toolkitClosed = 0;
let previewClosed = 0;
const miniAppWindow = {
    ipc: { postMessage: msg => miniAppIpcMessages.push(JSON.parse(msg)) },
    __thkToolkit: { close() { toolkitClosed++; } },
    open: (...args) => { openedPopups.push(args); return {}; }
};
const miniAppContext = vm.createContext({
    window: miniAppWindow,
    console,
    navigator: { platform: 'Win32', userAgent: 'Test' },
    closeMarkdownPreviewModal() { previewClosed++; }
});
const ipcSlice = source.slice(source.indexOf('    window.__chatwork_ipc ='), source.indexOf('    // Keep each toast'));
const miniAppSlice = source.slice(
    source.indexOf('    // ── 14. Attendance Mini App Popup'),
    source.indexOf('    // ── 15. Markdown')
);
vm.runInContext(ipcSlice + '\n' + miniAppSlice, miniAppContext);
assert.equal(miniAppWindow.__thk_openLeaveMiniApp, miniAppContext.openLeaveRequestModal);
assert.equal(miniAppContext.openLeaveRequestModal(), true);
assert.equal(toolkitClosed, 1, 'Opening attendance mini app closes open toolkit panel');
assert.equal(previewClosed, 1, 'Opening attendance mini app closes open preview modal');
assert.equal(miniAppIpcMessages.length, 1, 'Native IPC OpenMiniApp message is sent');
assert.deepEqual(miniAppIpcMessages[0], {
    type: 'OpenMiniApp',
    payload: {
        url: 'https://attendance.thk-hd-hn.vn/',
        title: 'THK Quick Leave'
    }
});
assert.equal(openedPopups.length, 0, 'Native IPC path does not invoke browser window.open');

// Fallback when native IPC is unavailable uses window.open popup.
delete miniAppWindow.ipc;
assert.equal(miniAppContext.openLeaveRequestModal(), true);
assert.equal(openedPopups.length, 1);
assert.equal(openedPopups[0][0], 'https://attendance.thk-hd-hn.vn/');
assert.equal(openedPopups[0][1], 'thk_quick_leave');
assert.ok(String(openedPopups[0][2]).includes('popup=yes'));

const messages = [];
const timers = [];
const handlers = {};
let scrolls = 0;
const document = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    getElementById: id => id === '_message999999999999999999' ? { scrollIntoView() { scrolls++; } } : null,
    querySelector: () => null
};
const location = { href: 'https://www.chatwork.com/#!rid1', hash: '#!rid1' };
const window = { location, dispatchEvent() {}, ipc: { postMessage: msg => messages.push(JSON.parse(msg)) } };
const navContext = vm.createContext({ window, document, Date, Math, Map, URL, Event: TestEvent, EventTarget: TestEventTarget,
    console, HashChangeEvent: TestEvent, setTimeout: fn => timers.push(fn) });
const bridge = source.slice(source.indexOf('    window.__chatwork_ipc ='), source.indexOf('    let _notificationApi'));
const polyfill = source.slice(source.indexOf('    function NativeNotificationPolyfill'), source.indexOf('    NativeNotificationPolyfill.permission'));
const navigation = source.slice(source.indexOf('    function getMessageHash'), source.indexOf('    // ── 8.'));
vm.runInContext(bridge + polyfill + navigation, navContext);
assert.equal(navContext.getMessageHash('https://www.chatwork.com/#!rid123-999999999999999999'), '#!rid123-999999999999999999');
assert.equal(navContext.getMessageHash('#_rid123-456'), '#!rid123-456');
assert.equal(navContext.getMessageHash('https://example.com/#!rid123-456'), null);
assert.equal(navContext.getMessageHash('https://chatwork.com.evil.test/#!rid123-456'), null);
assert.equal(navContext.getMessageHash('javascript:alert(1)'), null);
window.__thk_navigateToMessage('#!rid123-999999999999999999');
while (timers.length) timers.shift()();
assert.equal(location.hash, '#!rid123-999999999999999999');
assert.equal(scrolls, 1);
// A different navigation cancels a pending scroll to the old message.
window.__thk_navigateToMessage('#!rid1-999999999999999999');
window.__thk_navigateToMessage('#!rid2');
while (timers.length) timers.shift()();
assert.equal(scrolls, 1);
const first = new navContext.NativeNotificationPolyfill('First', { body: 'A', data: { room_id: '11', message_id: '111' } });
const firstId = messages.at(-1).payload.id;
const second = new navContext.NativeNotificationPolyfill('Second', { body: 'B', data: { roomId: '22', messageId: '222' } });
const secondId = messages.at(-1).payload.id;
let firstClicks = 0, secondClicks = 0;
first.onclick = () => firstClicks++;
second.addEventListener('click', () => secondClicks++);
window.__thk_notificationClicked(firstId);
assert.equal(firstClicks, 1); assert.equal(secondClicks, 0);
assert.equal(location.hash, '#!rid11-111');
window.__thk_notificationClicked(secondId);
assert.equal(secondClicks, 1); assert.equal(location.hash, '#!rid22-222');
window.__thk_notificationClicked(firstId);
assert.equal(firstClicks, 1, 'Already handled toast does not fire twice');
const closed = new navContext.NativeNotificationPolyfill('Closed', {});
closed.onclick = () => assert.fail('Dismissal must not navigate');
const closedId = messages.at(-1).payload.id;
window.__thk_notificationClosed(closedId); window.__thk_notificationClicked(closedId);
const callback = navContext.createChatworkNotification('icon', 'Title', 'Body');
callback.onclick = () => window.__thk_navigateToMessage('#!rid33-333');
window.__thk_notificationClicked(messages.at(-1).payload.id);
assert.equal(location.hash, '#!rid33-333', 'NotificationAPI callback navigates to its original message');
// Sender avatars come from the user profile, independent of the active room.
window.CW={application:{domainServiceContext:{userService:{userRepository:{entities:{
    '101':{profile:{profileImage:{value:'avatar/sender-101.png'}}},
    '202':{profile:{profileImage:{value:{url:'https://appdata.chatwork.com/avatar/sender-202.jpg'}}}}
}}}}}};
new navContext.NativeNotificationPolyfill('Sender 101',{icon:'https://www.chatwork.com/room.png',data:{account_id:'101',room_id:'11',message_id:'111'}});
assert.equal(messages.at(-1).payload.icon,'https://appdata.chatwork.com/avatar/sender-101.png');
new navContext.NativeNotificationPolyfill('Sender 202',{data:{sender_id:{value:'202'}}});
assert.equal(messages.at(-1).payload.icon,'https://appdata.chatwork.com/avatar/sender-202.jpg','Wrapped profile images and sender IDs are resolved');
navContext.createChatworkNotification('https://www.chatwork.com/room.png','Legacy','Body',{account_id:'101'});
assert.equal(messages.at(-1).payload.icon,'https://appdata.chatwork.com/avatar/sender-101.png','Legacy NotificationAPI resolves the sender avatar too');
new navContext.NativeNotificationPolyfill('Unknown sender',{icon:'https://appdata.chatwork.com/avatar/provided.png',data:{account_id:'missing'}});
assert.equal(messages.at(-1).payload.icon,'https://appdata.chatwork.com/avatar/provided.png','Explicit avatars remain available without a profile');
new navContext.NativeNotificationPolyfill('No avatar',{});
assert.equal(messages.at(-1).payload.icon,null,'Missing avatars do not suppress a notification');
window.__thkToolkit={resolveAvatarUrl:()=>''};
new navContext.NativeNotificationPolyfill('Invalid avatar',{icon:'invalid'});
assert.equal(messages.at(-1).payload.icon,null,'Rejected avatars do not resolve to the current chat page');
delete window.__thkToolkit;

// Scrolling still completes when Chatwork normalizes #!rid<room>-<msg> to #!rid<room>.
window.__thk_navigateToMessage('#!rid123-999999999999999999');
location.hash = '#!rid123';
while (timers.length) timers.shift()();
assert.equal(scrolls, 2, 'Normalized room hash still scrolls to the target message');

// Multiple notifications without options.data resolve each toast's own room + message
// and ignore Chatwork's singleton onclick pointing at the last notification's room.
window.CW = {
    popup: { last_rid: '' },
    application: {
        domainServiceContext: {
            roomService: {
                roomRepository: {
                    entities: {
                        '501': { identity: { value: '501' }, name: { value: 'Backend Team' } },
                        '502': { identity: { value: '502' }, name: { value: 'Frontend Team' } },
                        '503': { identity: { value: '503' }, name: { value: 'QA Team' } }
                    }
                }
            },
            userService: {
                userRepository: {
                    entities: {
                        '101': { identity: { value: '101' }, name: { value: 'Alice' }, profile: { profileImage: { value: 'avatar/sender-101.png' } } },
                        '202': { identity: { value: '202' }, name: { value: 'Bob' }, profile: { profileImage: { value: { url: 'https://appdata.chatwork.com/avatar/sender-202.jpg' } } } }
                    }
                }
            }
        }
    }
};
let selectedByLegacyRouter = '';
window.RL = { selectRoom: rid => { selectedByLegacyRouter = String(rid); location.hash = '#!rid' + rid; } };
window.__thk_recordIncomingPayload({
    result: {
        update_info: {
            room_dat: {
                '501': { chat_list: [{ id: '9001', aid: '101', msg: '[To:999] Alice\nPlease review API schema', tm: 1700000001 }] },
                '502': { chat_list: [{ id: '9002', aid: '202', msg: '[info][title]Deploy[/title]Staging build ready[/info]', tm: 1700000002 }] },
                '503': { chat_list: [{ id: '9003', aid: '101', msg: 'Regression suite green', tm: 1700000003 }] }
            }
        }
    }
});
let singletonLastRoom = '501';
window.CW.popup.last_rid = '501';
const multi1 = new navContext.NativeNotificationPolyfill('Backend Team', { body: 'Alice: Please review API schema', tag: 'chatwork' });
multi1.onclick = e => { e.preventDefault(); window.RL.selectRoom(singletonLastRoom); };
const multi1Payload = messages.at(-1).payload;

singletonLastRoom = '502';
window.CW.popup.last_rid = '502';
const multi2 = new navContext.NativeNotificationPolyfill('Frontend Team', { body: 'Deploy Staging build ready', tag: 'chatwork' });
multi2.onclick = e => { e.preventDefault(); window.RL.selectRoom(singletonLastRoom); };
const multi2Payload = messages.at(-1).payload;

singletonLastRoom = '503';
window.CW.popup.last_rid = '503';
const multi3 = new navContext.NativeNotificationPolyfill('QA Team', { body: 'Regression suite green', tag: 'chatwork' });
multi3.onclick = e => { e.preventDefault(); window.RL.selectRoom(singletonLastRoom); };
const multi3Payload = messages.at(-1).payload;

assert.equal(multi1Payload.target, '#!rid501-9001', 'First notification captures its exact room and message');
assert.equal(multi1Payload.icon, 'https://appdata.chatwork.com/avatar/sender-101.png', 'First notification resolves sender avatar from incoming message');
assert.equal(multi2Payload.target, '#!rid502-9002', 'Second notification captures its exact room and message');
assert.equal(multi2Payload.icon, 'https://appdata.chatwork.com/avatar/sender-202.jpg', 'Second notification resolves sender avatar from incoming message');
assert.equal(multi3Payload.target, '#!rid503-9003', 'Third notification captures its exact room and message');

// Clicking the FIRST notification after 3 notifications arrived must open Room 501 Message 9001, NOT Room 503!
window.__thk_notificationClicked(multi1Payload.id);
assert.equal(location.hash, '#!rid501-9001', 'Clicking earlier notification opens its own message instead of the latest notification');
assert.notEqual(selectedByLegacyRouter, '503', 'Legacy singleton room selector is blocked from hijacking to the last room');

window.__thk_notificationClicked(multi2Payload.id);
assert.equal(location.hash, '#!rid502-9002', 'Clicking second notification opens second message');

// Duplicate short messages in the same room map to distinct message IDs in arrival order.
window.__thk_recordIncomingPayload({
    room_dat: {
        '501': {
            chat_list: [
                { id: '9010', aid: '101', msg: 'OK' },
                { id: '9011', aid: '202', msg: 'OK' }
            ]
        }
    }
});
new navContext.NativeNotificationPolyfill('Backend Team', { body: 'OK' });
assert.equal(messages.at(-1).payload.target, '#!rid501-9010');
new navContext.NativeNotificationPolyfill('Backend Team', { body: 'OK' });
assert.equal(messages.at(-1).payload.target, '#!rid501-9011');

// Wrapped DDD value objects and tag room/message identifiers are unwrapped properly.
new navContext.NativeNotificationPolyfill('Wrapped IDs', {
    data: { roomId: { value: '77' }, messageId: { getValue: () => '777' } }
});
assert.equal(messages.at(-1).payload.target, '#!rid77-777');
new navContext.NativeNotificationPolyfill('Tag IDs', { tag: 'rid88-888' });
assert.equal(messages.at(-1).payload.target, '#!rid88-888');

// Chatwork repositories can return keyed collections or be temporarily unavailable.
const services = window.CW.application.domainServiceContext;
services.userService.userRepository.getAll = () => ({ '606': { name: 'New Sender' } });
services.roomService.roomRepository.getAll = () => new Map([
    ['506', { name: 'New Room', latestMessageId: '9006' }]
]);
const beforeKeyed = messages.length;
new navContext.NativeNotificationPolyfill('New Room', { body: 'New message' });
assert.equal(messages.length, beforeKeyed + 1);
assert.equal(messages.at(-1).payload.target, '#!rid506-9006');

services.roomService.roomRepository.getAll = () => { throw new Error('Room repository loading'); };
navContext.createChatworkNotification('Backend Team', 'Please review API schema');
assert.equal(messages.at(-1).payload.target, '#!rid501-9001', 'Cached rooms remain available');

services.roomService.roomRepository.entities['501'].getName = () => { throw new Error('Room data loading'); };
Object.defineProperty(services.userService.userRepository.entities['101'].profile, 'profileImage', {
    get() { throw new Error('Avatar data loading'); }
});
const beforeFallback = messages.length;
let fallbackClicks = 0;
const fallback = new navContext.NativeNotificationPolyfill('Backend Team', {
    body: 'Please review API schema', data: { roomId: '501', accountId: '101' }
});
fallback.onclick = () => fallbackClicks++;
assert.equal(messages.length, beforeFallback + 1);
assert.equal(messages.at(-1).payload.body, 'Please review API schema');
assert.equal(messages.at(-1).payload.target, '#!rid501');
assert.equal(messages.at(-1).payload.icon, null);
window.__thk_notificationClicked(messages.at(-1).payload.id);
assert.equal(fallbackClicks, 1, 'Click handler still works when enrichment fails');
assert.equal(location.hash, '#!rid501');
while (timers.length) timers.shift()();

console.log('Leave request, message navigation and sender avatar regression checks passed.');
