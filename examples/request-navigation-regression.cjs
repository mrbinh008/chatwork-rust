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
const context = vm.createContext({ Date, Set });
vm.runInContext(source.slice(source.indexOf('    function formatLeaveDate'), source.indexOf('    function openLeaveRequestModal')), context);
assert.equal(context.formatLeaveRequest('HALF-DAY_PAID_LEAVE', ['2026-11-12'], '13:00', '17:00', 'Personal matter'),
    '[info]\n- Request: HALF-DAY_PAID_LEAVE\n- Time: 13:00 - 17:00  12/11/2026\n- Reason: Personal matter\n[/info]\n');
assert.equal(context.formatLeaveRequest('PAID_LEAVE', ['2026-11-14', '2026-11-12', '2026-11-12'], '08:30', '16:45', '私用のため'),
    '[info]\n- Request: PAID_LEAVE\n- Time: 08:30 - 16:45  12/11/2026\n- Time: 08:30 - 16:45  14/11/2026\n- Reason: 私用のため\n[/info]\n');
assert.equal(context.getLeaveDateRange('2026-11-12', '2026-11-14').join(','), '2026-11-12,2026-11-13,2026-11-14');
assert.equal(context.getLeaveDateRange('2028-02-28', '2028-03-01').join(','), '2028-02-28,2028-02-29,2028-03-01');
assert.equal(context.getLeaveDateRange('2026-12-31', '2027-01-01').join(','), '2026-12-31,2027-01-01');
assert.throws(() => context.getLeaveDateRange('2026-02-30', '2026-03-01'));
assert.throws(() => context.getLeaveDateRange('2026-11-14', '2026-11-12'));
assert.throws(() => context.getLeaveDateRange('', ''));
assert.equal(context.validateLeaveRequest(['2026-11-12'], '13:00', '17:00', 'Personal matter'), '');
for (const values of [[[], '13:00', '17:00', 'Reason'], [['2026-11-12'], '', '17:00', 'Reason'],
    [['2026-11-12'], '17:00', '13:00', 'Reason'], [['2026-11-12'], '13:00', '13:00', 'Reason'],
    [['2026-11-12'], '13:00', '17:00', ' ']]) assert.ok(context.validateLeaveRequest(...values));


const pairs=[{date:'2026-11-12',start:'08:00',end:'12:00'},{date:'2026-11-13',start:'13:00',end:'17:00'}];
assert.equal(context.validateLeaveRequest(pairs,'','','Personal matter'),'');
assert.ok(context.formatLeaveRequest('PAID_LEAVE',pairs,'','','Personal matter').includes('- Time: 08:00 - 12:00  12/11/2026\n- Time: 13:00 - 17:00  13/11/2026'));
assert.ok(context.validateLeaveRequest([...pairs,{date:'2026-11-12',start:'09:00',end:'10:00'}],'','','Reason'));
assert.ok(context.validateLeaveRequest([{date:'2026-02-30',start:'08:00',end:'12:00'}],'','','Reason'));
assert.ok(context.validateLeaveRequest([{date:'2026-11-12',start:'17:00',end:'13:00'}],'','','Reason'));
assert.throws(()=>context.getLeaveDateRange('2026-01-01','2028-01-01'));

const leaderMessage = context.formatLeaveRequest('PAID_LEAVE', ['2026-11-12'], '08:00', '17:00', 'Personal matter', [
    {id:'101',name:'Leader A'}, {id:'102',name:'Leader B'}, {id:'101',name:'Duplicate'}, {id:'bad',name:'Invalid'}
]);
assert.equal(leaderMessage, '[To:101] Leader A\n[To:102] Leader B\n[info]\n- Request: PAID_LEAVE\n- Time: 08:00 - 17:00  12/11/2026\n- Reason: Personal matter\n[/info]\n');
assert.ok(context.formatLeaveRequest('PAID_LEAVE', ['2026-11-12'], '08:00', '17:00', 'Reason', [{id:'101',name:'Name\n[To:all]'}]).startsWith('[To:101] Name ［To:all］\n'));
const leaderStorage = new Map();
context.localStorage = { getItem:key=>leaderStorage.get(key)??null, setItem:(key,value)=>leaderStorage.set(key,value) };
context.window = {CW:{application:{myId:{userId:{value:'999'}}}},location:{hash:'#!rid1'}};
const leaderKey = context.getLeaveLeaderStorageKey();
context.rememberLeaveLeaders(leaderKey, ['101','102','101','bad']);
assert.equal(context.readLeaveLeaders(leaderKey).join(','),'101,102');
context.rememberLeaveLeaders(leaderKey, ['102']);
assert.equal(context.readLeaveLeaders(leaderKey).join(','),'102','Removed leaders are not restored');
context.window.location.hash='#!rid2';
assert.equal(context.readLeaveLeaders(context.getLeaveLeaderStorageKey()).length,0,'Remember leaders per room');
context.window.location.hash='#!rid1'; context.window.CW.application.myId.userId.value='1000';
assert.equal(context.readLeaveLeaders(context.getLeaveLeaderStorageKey()).length,0,'Do not mix accounts');
leaderStorage.set(leaderKey,'invalid JSON');assert.equal(context.readLeaveLeaders(leaderKey).length,0);

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
console.log('Leave request, message navigation and sender avatar regression checks passed.');
