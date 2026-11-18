(function() {
    'use strict';

    const APP_ZOOM = '__ZOOM__';
    const APP_VERSION = '__VERSION__';

    // ── 1. Apply Zoom Factor ──────────────────────────────────────────────────
    function applyZoom() {
        if (document.documentElement) {
            document.documentElement.style.zoom = APP_ZOOM;
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyZoom);
    } else {
        applyZoom();
    }

    // ── 2. Chatwork Native IPC Bridge ─────────────────────────────────────────
    window.__chatwork_ipc = {
        send: function(type, payload) {
            try {
                if (window.ipc && window.ipc.postMessage) {
                    window.ipc.postMessage(JSON.stringify({ type: type, payload: payload }));
                }
            } catch(e) {
                console.error('[THK Native Client] IPC send error:', e);
            }
        },
        notify: function(title, body, notification, target, icon, options) {
            const normalizedTarget = target ? getMessageHash(target) : null;
            const id = notification ? registerNativeNotification(notification, normalizedTarget, options) : null;
            window.__chatwork_ipc.send('ShowNotification', {
                title: String(title || 'THK-Chat'),
                body: String(body || ''),
                id: id,
                target: normalizedTarget,
                icon: typeof icon === 'string' && icon.trim() ? icon.trim() : null
            });
        },
        setBadge: function(count) {
            window.__chatwork_ipc.send('SetBadgeCount', Number(count) || 0);
        },
        goBack: function() {
            window.__chatwork_ipc.send('GoBack', null);
        },
        goForward: function() {
            window.__chatwork_ipc.send('GoForward', null);
        },
        setAppIcon: function(variant) {
            window.__chatwork_ipc.send('SetAppIcon', String(variant || 'original'));
        },
        getVersion: function() {
            return APP_VERSION;
        },
        getOsInfo: function() {
            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            return {
                platform: isMac ? 'darwin' : 'win32',
                arch: 'x64',
                version: isMac ? '14.0' : '10.0',
                release: isMac ? '23.0.0' : '10.0.19041'
            };
        },
        getUserAgent: function() {
            return navigator.userAgent;
        }
    };

    // Keep each toast tied to its own click handler and message target, even with many pending toasts.
    const nativeNotifications = new Map();
    const recentIncomingMessages = [];
    const recentIncomingIndex = new Map();
    const notificationSession = Date.now().toString(36) + Math.random().toString(36).slice(2);
    let notificationSequence = 0;

    function unwrapNotificationValue(input) {
        for (let depth = 0; input && typeof input === 'object' && depth < 5; depth++) {
            const next = input.getValue?.() ?? input.value ?? input.identity ?? input.userId ?? input.roomId ?? input.messageId ?? input.id;
            if (next === undefined || next === input) break;
            input = next;
        }
        return input;
    }
    function cleanNumericId(value) {
        const unwrapped = unwrapNotificationValue(value);
        if (typeof unwrapped !== 'string' && typeof unwrapped !== 'number') return '';
        const text = String(unwrapped).trim();
        return /^\d+$/.test(text) ? text : '';
    }
    function normalizeNotificationText(text, stripTagsLine = true) {
        if (typeof text !== 'string') return '';
        let cleaned = text.replace(/\[qt\][\s\S]*?\[\/qt\]/gi, ' ');
        if (stripTagsLine) {
            cleaned = cleaned.replace(/\[(?:To:\d+|rp\s+[^\]]+|picon(?:name)?:\d+|dtext:[^\]]+)\][^\n]*/gi, ' ');
        }
        return cleaned
            .replace(/\[\/?(?:info|title|code|hr|toall|download(?::\d+)?|To:\d+|rp\s+[^\]]+|picon(?:name)?:\d+|dtext:[^\]]+)\]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }
    function recordIncomingMessage(roomId, messageId, accountId, body, timestamp) {
        const rid = cleanNumericId(roomId);
        const mid = cleanNumericId(messageId);
        if (!rid || !mid) return;
        const key = rid + '-' + mid;
        const now = Date.now();
        const aid = cleanNumericId(accountId);
        const text = typeof body === 'string' ? body : String(unwrapNotificationValue(body) ?? '');
        const existing = recentIncomingIndex.get(key);
        if (existing) {
            if (aid && !existing.accountId) existing.accountId = aid;
            if (text && !existing.body) existing.body = text;
            existing.capturedAt = now;
            return;
        }
        const entry = {
            key,
            roomId: rid,
            messageId: mid,
            accountId: aid,
            body: text,
            timestamp: Number(unwrapNotificationValue(timestamp)) || 0,
            capturedAt: now,
            usedForNotification: false
        };
        recentIncomingMessages.push(entry);
        recentIncomingIndex.set(key, entry);
        const cutoff = now - 15 * 60 * 1000;
        while (recentIncomingMessages.length > 250 || (recentIncomingMessages.length > 50 && recentIncomingMessages[0].capturedAt < cutoff)) {
            const removed = recentIncomingMessages.shift();
            if (removed) recentIncomingIndex.delete(removed.key);
        }
    }
    function ingestChatListForRoom(roomId, chatList) {
        if (!chatList || typeof chatList !== 'object') return;
        const items = Array.isArray(chatList) ? chatList : Object.entries(chatList).map(([k, v]) => (v && typeof v === 'object' ? { id: k, ...v } : null));
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            const mid = item.id ?? item.mid ?? item.message_id ?? item.messageId ?? item.chat_id ?? item.chatId ?? item.identity;
            const aid = item.aid ?? item.account_id ?? item.accountId ?? item.sender_id ?? item.from_id ?? item.userId;
            const msg = item.msg ?? item.body ?? item.message ?? item.text;
            const tm = item.tm ?? item.send_time ?? item.timestamp ?? item.time;
            recordIncomingMessage(roomId, mid, aid, msg, tm);
        }
    }
    function ingestIncomingData(data, depth = 0) {
        if (!data || typeof data !== 'object' || depth > 5) return;
        if (Array.isArray(data)) {
            for (let i = Math.max(0, data.length - 50); i < data.length; i++) ingestIncomingData(data[i], depth + 1);
            return;
        }
        const directRoom = cleanNumericId(data.room_id ?? data.roomId ?? data.rid);
        const directMsg = cleanNumericId(data.message_id ?? data.messageId ?? data.mid ?? data.chat_id ?? data.chatId);
        if (directRoom && directMsg) {
            recordIncomingMessage(
                directRoom,
                directMsg,
                data.account_id ?? data.accountId ?? data.aid ?? data.sender_id ?? data.from_id,
                data.body ?? data.msg ?? data.message ?? data.text,
                data.tm ?? data.send_time ?? data.timestamp
            );
        }
        if (directRoom && data.chat_list) ingestChatListForRoom(directRoom, data.chat_list);
        const roomDat = data.room_dat ?? data.rooms;
        if (roomDat && typeof roomDat === 'object' && !Array.isArray(roomDat)) {
            for (const [rid, roomObj] of Object.entries(roomDat)) {
                if (!roomObj || typeof roomObj !== 'object') continue;
                const resolvedRid = cleanNumericId(roomObj.rid ?? roomObj.room_id ?? rid);
                if (!resolvedRid) continue;
                if (roomObj.chat_list) ingestChatListForRoom(resolvedRid, roomObj.chat_list);
                if (roomObj.timeline?.chat_list) ingestChatListForRoom(resolvedRid, roomObj.timeline.chat_list);
            }
        }
        for (const key of ['result', 'update_info', 'data', 'payload', 'event', 'events', 'messages', 'message_data']) {
            if (data[key] && typeof data[key] === 'object') ingestIncomingData(data[key], depth + 1);
        }
    }
    window.__thk_recordIncomingPayload = ingestIncomingData;

    function setupIncomingMessageObservers() {
        try {
            if (typeof Response !== 'undefined' && Response.prototype && typeof Response.prototype.json === 'function') {
                const origJson = Response.prototype.json;
                Response.prototype.json = function() {
                    return origJson.apply(this, arguments).then(function(parsed) {
                        try { ingestIncomingData(parsed); } catch (_) {}
                        return parsed;
                    });
                };
            }
        } catch (_) {}
        try {
            if (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && typeof XMLHttpRequest.prototype.open === 'function') {
                const origOpen = XMLHttpRequest.prototype.open;
                XMLHttpRequest.prototype.open = function(method, url) {
                    const urlStr = typeof url === 'string' ? url : String(url ?? '');
                    if (/get_update|load_chat|init_load|get_room|chat|message|rooms/i.test(urlStr)) {
                        this.addEventListener('readystatechange', function() {
                            if (this.readyState !== 4 || this.status !== 200) return;
                            try {
                                if (this.responseType === 'json' && this.response) {
                                    ingestIncomingData(this.response);
                                } else if (!this.responseType || this.responseType === 'text') {
                                    const text = this.responseText;
                                    if (typeof text === 'string' && text.length > 1 && text.length < 10_000_000) {
                                        const trimmed = text.trimStart();
                                        if (trimmed.startsWith('{') || trimmed.startsWith('[')) ingestIncomingData(JSON.parse(trimmed));
                                    }
                                }
                            } catch (_) {}
                        });
                    }
                    return origOpen.apply(this, arguments);
                };
            }
        } catch (_) {}
        try {
            if (typeof window.WebSocket === 'function') {
                const OrigWebSocket = window.WebSocket;
                const WrappedWebSocket = function(url, protocols) {
                    const ws = arguments.length > 1 ? new OrigWebSocket(url, protocols) : new OrigWebSocket(url);
                    try {
                        ws.addEventListener('message', function(event) {
                            if (typeof event?.data !== 'string' || event.data.length < 2 || event.data.length > 2_000_000) return;
                            const trimmed = event.data.trimStart();
                            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                                try { ingestIncomingData(JSON.parse(trimmed)); } catch (_) {}
                            }
                        });
                    } catch (_) {}
                    return ws;
                };
                WrappedWebSocket.prototype = OrigWebSocket.prototype;
                Object.setPrototypeOf(WrappedWebSocket, OrigWebSocket);
                for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
                    if (key in OrigWebSocket) {
                        try { WrappedWebSocket[key] = OrigWebSocket[key]; } catch (_) {}
                    }
                }
                window.WebSocket = WrappedWebSocket;
            }
        } catch (_) {}
    }
    setupIncomingMessageObservers();

    function collectKnownRoomsAndStateMessages() {
        const rooms = new Map();
        const users = new Map();
        const stateMessages = [];
        const app = window.CW?.application;
        const userRepo = app?.domainServiceContext?.userService?.userRepository;
        const userList = userRepo?.getAll?.() || Object.values(userRepo?.entities || {});
        for (const user of userList) {
            const uid = cleanNumericId(user?.identity);
            if (!uid) continue;
            const uname = String(unwrapNotificationValue(user?.getName?.() ?? user?.name ?? user?.nickname) || '').trim();
            if (uname) users.set(uid, uname);
        }
        for (const [uid, user] of Object.entries(userRepo?.entities || {})) {
            const cleanUid = cleanNumericId(uid);
            if (cleanUid && !users.has(cleanUid)) {
                const uname = String(unwrapNotificationValue(user?.getName?.() ?? user?.name ?? user?.nickname) || '').trim();
                if (uname) users.set(cleanUid, uname);
            }
        }
        const roomRepo = app?.domainServiceContext?.roomService?.roomRepository;
        const roomEntries = roomRepo?.getAll
            ? (roomRepo.getAll() || []).map(entity => [cleanNumericId(entity?.identity), entity])
            : Object.entries(roomRepo?.entities || {});
        for (const [rawId, entity] of roomEntries) {
            const rid = cleanNumericId(entity?.identity ?? rawId);
            if (!rid) continue;
            const mateId = cleanNumericId(entity?.getMate?.() ?? entity?.mate);
            const mateName = mateId ? (users.get(mateId) || '') : '';
            const name = String(unwrapNotificationValue(entity?.getName?.() ?? entity?.name) || mateName || '').trim();
            const icon = String(unwrapNotificationValue(entity?.getIcon?.() ?? entity?.iconPath ?? entity?.icon ?? entity?.avatar) || '').trim();
            const latestMid = cleanNumericId(
                entity?.latestMessageId ?? entity?.lastMessageId ?? entity?.lastMessage?.identity ?? entity?.latestMessage?.identity
            );
            rooms.set(rid, { id: rid, name, mateId, mateName, icon, latestMessageId: latestMid });
            const embeddedList = entity?.chatList ?? entity?.messages ?? entity?.messageList;
            if (embeddedList) ingestChatListForRoom(rid, embeddedList);
        }
        if (window.RM?.room_dat && typeof window.RM.room_dat === 'object') {
            for (const [rawId, room] of Object.entries(window.RM.room_dat)) {
                const rid = cleanNumericId(room?.rid ?? room?.room_id ?? rawId);
                if (!rid || !room || typeof room !== 'object') continue;
                const mateId = cleanNumericId(room.aid ?? room.account_id);
                const mateName = mateId ? (users.get(mateId) || '') : '';
                const prev = rooms.get(rid);
                const name = prev?.name || String(unwrapNotificationValue(room.name) || mateName || '').trim();
                const icon = prev?.icon || String(unwrapNotificationValue(room.icon ?? room.icon_path ?? room.avatar) || '').trim();
                const latestMid = prev?.latestMessageId || cleanNumericId(room.last_chat_id ?? room.latest_chat_id);
                rooms.set(rid, { id: rid, name, mateId: prev?.mateId || mateId, mateName: prev?.mateName || mateName, icon, latestMessageId: latestMid });
                if (room.chat_list) ingestChatListForRoom(rid, room.chat_list);
                if (room.timeline?.chat_list) ingestChatListForRoom(rid, room.timeline.chat_list);
            }
        }
        const domainCtx = app?.domainServiceContext;
        if (domainCtx && typeof domainCtx === 'object') {
            for (const [serviceName, service] of Object.entries(domainCtx)) {
                if (!/message|chat|timeline/i.test(serviceName) || !service || typeof service !== 'object') continue;
                for (const repo of Object.values(service)) {
                    if (!repo || typeof repo !== 'object') continue;
                    const records = typeof repo.getAll === 'function' ? repo.getAll() : (repo.entities && typeof repo.entities === 'object' ? Object.values(repo.entities) : null);
                    if (!Array.isArray(records)) continue;
                    const start = Math.max(0, records.length - 100);
                    for (let i = start; i < records.length; i++) {
                        const rec = records[i];
                        if (!rec || typeof rec !== 'object') continue;
                        const rid = cleanNumericId(rec.roomId ?? rec.roomIdentity ?? rec.room_id ?? rec.rid);
                        const mid = cleanNumericId(rec.identity ?? rec.messageId ?? rec.message_id ?? rec.mid ?? rec.id);
                        if (!rid || !mid) continue;
                        stateMessages.push({
                            roomId: rid,
                            messageId: mid,
                            accountId: cleanNumericId(rec.accountId ?? rec.userId ?? rec.sender ?? rec.aid),
                            body: String(unwrapNotificationValue(rec.body ?? rec.message ?? rec.text ?? rec.msg) ?? '')
                        });
                    }
                }
            }
        }
        for (const msg of stateMessages) recordIncomingMessage(msg.roomId, msg.messageId, msg.accountId, msg.body, 0);
        return { rooms, users };
    }

    function scoreRoomMatch(room, rawTitle, rawIcon) {
        if (!room) return 0;
        let score = 0;
        const cleanTitle = String(rawTitle || '').replace(/^\[\d+\+?\s*\]\s*/, '').trim();
        if (cleanTitle) {
            const titleLower = cleanTitle.toLowerCase();
            for (const candidateName of [room.name, room.mateName]) {
                if (!candidateName) continue;
                const nameLower = candidateName.trim().toLowerCase();
                if (!nameLower) continue;
                if (titleLower === nameLower) {
                    score = Math.max(score, 100);
                } else if (titleLower === 'chatwork - ' + nameLower || titleLower === nameLower + ' - chatwork') {
                    score = Math.max(score, 92);
                } else {
                    const strippedEllipsis = titleLower.replace(/(?:\.\.\.|…)+$/, '').trim();
                    if (strippedEllipsis.length >= 4 && nameLower.startsWith(strippedEllipsis)) {
                        score = Math.max(score, 85);
                    }
                }
            }
        }
        if (rawIcon && room.icon) {
            try {
                const notifPath = new URL(rawIcon, window.location.href).pathname;
                const roomPath = new URL(room.icon, window.location.href).pathname;
                if (notifPath && notifPath.length > 6 && notifPath === roomPath && !/default|blank|ico_default/i.test(notifPath)) {
                    score += 60;
                }
            } catch (_) {}
        }
        return score;
    }

    function scoreBodyMatch(msgBody, notifBody, senderName) {
        if (typeof msgBody !== 'string' || typeof notifBody !== 'string') return 0;
        const rawNotif = notifBody.trim();
        const rawMsg = msgBody.trim();
        if (!rawNotif || !rawMsg) return 0;
        const notifVariants = [rawNotif];
        if (senderName) {
            const lowerSender = senderName.toLowerCase();
            for (const sep of [': ', '：', '\n', ' - ']) {
                if (rawNotif.toLowerCase().startsWith(lowerSender + sep.toLowerCase())) {
                    const rest = rawNotif.slice(senderName.length + sep.length).trim();
                    if (rest) notifVariants.push(rest);
                }
            }
        }
        const msgStrict = normalizeNotificationText(rawMsg, true);
        const msgSoft = normalizeNotificationText(rawMsg, false);
        for (const variant of notifVariants) {
            const withoutEllipsis = variant.replace(/(?:\.\.\.|…)+$/, '').trim();
            for (const candidate of [variant, withoutEllipsis]) {
                const bodyStrict = normalizeNotificationText(candidate, true);
                const bodySoft = normalizeNotificationText(candidate, false);
                if (bodyStrict && msgStrict) {
                    if (bodyStrict === msgStrict) return 120;
                    if (bodyStrict.length >= 3 && (msgStrict.includes(bodyStrict) || bodyStrict.includes(msgStrict))) return 95;
                }
                if (bodySoft && msgSoft) {
                    if (bodySoft === msgSoft) return 110;
                    if (bodySoft.length >= 3 && (msgSoft.includes(bodySoft) || bodySoft.includes(msgSoft))) return 88;
                }
            }
        }
        return 0;
    }

    function parseExplicitTarget(options, notification) {
        let roomId = '', messageId = '', senderId = '';
        const sources = [];
        if (options && typeof options === 'object') {
            if (options.data && typeof options.data === 'object') sources.push(options.data);
            sources.push(options);
        }
        if (notification && typeof notification === 'object') {
            if (notification.data && typeof notification.data === 'object') sources.push(notification.data);
            sources.push(notification);
        }
        for (const src of sources) {
            const url = unwrapNotificationValue(src.url ?? src.link ?? src.href);
            if (typeof url === 'string') {
                const hash = getMessageHash(url);
                if (hash) {
                    const m = hash.match(/^#!rid(\d+)(?:-(\d+))?$/);
                    if (m) {
                        roomId = roomId || m[1];
                        messageId = messageId || m[2] || '';
                    }
                }
            }
            roomId = roomId || cleanNumericId(src.room_id ?? src.roomId ?? src.rid ?? src.room);
            messageId = messageId || cleanNumericId(src.message_id ?? src.messageId ?? src.mid ?? src.chat_id ?? src.chatId);
            senderId = senderId || cleanNumericId(src.account_id ?? src.accountId ?? src.from_id ?? src.sender_id ?? src.aid);
            const tag = unwrapNotificationValue(src.tag);
            if (typeof tag === 'string' && tag.trim()) {
                const tagMatch = tag.trim().match(/(?:^|\b)(?:#(?:!|_))?rid(\d+)(?:-(\d+))?\b/i)
                    || tag.trim().match(/^(\d+)-(\d+)$/);
                if (tagMatch) {
                    roomId = roomId || tagMatch[1];
                    messageId = messageId || tagMatch[2] || '';
                }
            }
        }
        const bodyText = String(notification?.body ?? options?.body ?? '');
        if (!roomId && bodyText) {
            const rpMatch = bodyText.match(/\[rp\s+[^\]]*\bto=(\d+)(?:-\d+)?\]/i);
            if (rpMatch) roomId = rpMatch[1];
        }
        return { roomId, messageId, senderId };
    }

    function resolveNotificationContext(notification, options) {
        const explicit = parseExplicitTarget(options, notification);
        let { roomId, messageId, senderId } = explicit;
        if (roomId && messageId) {
            return { target: '#!rid' + roomId + '-' + messageId, roomId, messageId, senderId };
        }
        const { rooms, users } = collectKnownRoomsAndStateMessages();
        const rawTitle = String(notification?.title || '').trim();
        const rawBody = String(notification?.body ?? options?.body ?? '').trim();
        const rawIcon = String(notification?.icon || options?.icon || options?.avatar || options?.image || '').trim();
        const popupRid = cleanNumericId(window.CW?.popup?.last_rid ?? window.CW?.popup?.rid ?? window.CW?.popup?.room_id);
        const now = Date.now();

        let bestEntry = null;
        let bestScore = 0;
        for (let i = 0; i < recentIncomingMessages.length; i++) {
            const msg = recentIncomingMessages[i];
            if (roomId && msg.roomId !== roomId) continue;
            if (senderId && msg.accountId && msg.accountId !== senderId) continue;
            const room = rooms.get(msg.roomId);
            const senderName = msg.accountId ? (users.get(msg.accountId) || '') : '';
            let score = 0;
            if (roomId && msg.roomId === roomId) {
                score += 120;
            } else {
                score += scoreRoomMatch(room, rawTitle, rawIcon);
                if (senderName && rawTitle && rawTitle.toLowerCase() === senderName.toLowerCase()) score += 75;
                if (popupRid && msg.roomId === popupRid) score += 55;
            }
            const bScore = scoreBodyMatch(msg.body, rawBody, senderName);
            score += bScore;
            if (score < 85 && bScore < 88) continue;
            if (now - msg.capturedAt < 15000) score += 40;
            if (!msg.usedForNotification) score += 35;
            // For tied fresh unconsumed messages in the same batch, keep chronological emission order.
            if (!bestEntry || score > bestScore) {
                bestScore = score;
                bestEntry = msg;
            }
        }
        if (bestEntry) {
            bestEntry.usedForNotification = true;
            roomId = roomId || bestEntry.roomId;
            messageId = messageId || bestEntry.messageId;
            senderId = senderId || bestEntry.accountId;
        }
        if (!roomId) {
            let bestRoom = null;
            let bestRoomScore = 0;
            for (const room of rooms.values()) {
                let rScore = scoreRoomMatch(room, rawTitle, rawIcon);
                if (popupRid && room.id === popupRid) rScore += 55;
                if (rScore > bestRoomScore) {
                    bestRoomScore = rScore;
                    bestRoom = room;
                }
            }
            if (bestRoom && bestRoomScore >= 85) {
                roomId = bestRoom.id;
                messageId = messageId || bestRoom.latestMessageId || '';
                senderId = senderId || bestRoom.mateId || '';
            } else if (popupRid) {
                roomId = popupRid;
                messageId = messageId || rooms.get(popupRid)?.latestMessageId || '';
            }
        } else if (!messageId) {
            messageId = rooms.get(roomId)?.latestMessageId || '';
        }
        const target = roomId ? ('#!rid' + roomId + (messageId ? '-' + messageId : '')) : null;
        return { target, roomId, messageId, senderId };
    }

    function registerNativeNotification(notification, target, options) {
        const id = notificationSession + '-' + (++notificationSequence);
        if (nativeNotifications.size >= 250) {
            const oldestKey = nativeNotifications.keys().next().value;
            if (oldestKey !== undefined) nativeNotifications.delete(oldestKey);
        }
        const entry = { notification, target, options };
        nativeNotifications.set(id, entry);
        if (notification && typeof notification === 'object') {
            notification.__thkNotificationEntry = entry;
        }
        return id;
    }
    window.__thk_notificationClosed = function(id) { nativeNotifications.delete(id); };
    window.__thk_notificationClicked = function(id) {
        const entry = nativeNotifications.get(id);
        if (!entry) return false;
        nativeNotifications.delete(id);
        const pinnedTarget = entry.target ? getMessageHash(entry.target) : null;
        const pinnedRoomId = pinnedTarget?.match(/^#!rid(\d+)/)?.[1] || '';
        const event = new Event('click', { cancelable: true });
        const origSelectRoom = pinnedRoomId && typeof window.RL?.selectRoom === 'function' ? window.RL.selectRoom : null;
        if (origSelectRoom) {
            window.RL.selectRoom = function(rid) {
                if (String(rid) === pinnedRoomId) return origSelectRoom.apply(this, arguments);
            };
        }
        try {
            entry.notification.dispatchEvent(event);
        } finally {
            if (origSelectRoom && window.RL) window.RL.selectRoom = origSelectRoom;
        }
        // Always navigate to this notification's captured room/message so Chatwork's
        // singleton onclick handler cannot redirect earlier toasts to the latest room.
        if (pinnedTarget) {
            window.__thk_navigateToMessage(pinnedTarget);
        }
        return true;
    };
    function refreshNotificationEntryTarget(notification, options) {
        const entry = notification?.__thkNotificationEntry;
        if (!entry || (entry.target && /-\d+$/.test(entry.target))) return;
        const resolved = resolveNotificationContext(notification, options);
        if (resolved.target && (!entry.target || /-\d+$/.test(resolved.target))) {
            entry.target = getMessageHash(resolved.target) || entry.target;
        }
    }
    function initializeNativeNotification(notification, options) {
        const events = new EventTarget();
        let onclickHandler = null;
        Object.defineProperty(notification, 'onclick', {
            configurable: true,
            enumerable: true,
            get: function() { return onclickHandler; },
            set: function(fn) {
                onclickHandler = typeof fn === 'function' ? fn : null;
                if (onclickHandler) refreshNotificationEntryTarget(notification, options);
            }
        });
        notification.onclose = null;
        const boundAddEventListener = events.addEventListener.bind(events);
        notification.addEventListener = function(type, listener, opts) {
            if (type === 'click') refreshNotificationEntryTarget(notification, options);
            return boundAddEventListener(type, listener, opts);
        };
        notification.removeEventListener = events.removeEventListener.bind(events);
        notification.dispatchEvent = function(event) {
            const handler = notification['on' + event.type];
            if (typeof handler === 'function') {
                try { handler.call(notification, event); } catch(error) { console.error(error); }
            }
            return events.dispatchEvent(event);
        };
        notification.close = notification.cancel = function() {};
        notification.show = function() {};
        const context = resolveNotificationContext(notification, options);
        const icon = getNotificationAvatar(notification, options, context.senderId);
        window.__chatwork_ipc.notify(notification.title, notification.body, notification, context.target, icon, options);
    }
    function getNotificationAvatar(notification, options, inferredSenderId) {
        const unwrap = unwrapNotificationValue;
        const data = options?.data || {};
        const sender = unwrap(data.account_id ?? data.accountId ?? data.from_id ?? data.sender_id ?? data.aid
            ?? options?.account_id ?? options?.accountId ?? options?.sender_id ?? inferredSenderId);
        const user = window.CW?.application?.domainServiceContext?.userService?.userRepository?.entities?.[sender];
        // Prefer the sender's profile to an icon for the room or the application.
        const candidates = [user?.profile?.profileImage, user?.avatarUrl, user?.avatar,
            notification.icon, options?.icon, options?.avatar, options?.image];
        if (sender && typeof window.AC?.getAvatar === 'function') {
            try { candidates.splice(3, 0, window.AC.getAvatar(sender)); } catch (_) {}
        }
        for (let icon of candidates) {
            for (let depth = 0; icon && typeof icon === 'object' && depth < 5; depth++) {
                icon = unwrap(icon?.url ?? icon?.src ?? icon);
            }
            if (typeof icon !== 'string' || !icon.trim()) continue;
            try {
                if (window.__thkToolkit?.resolveAvatarUrl) icon = window.__thkToolkit.resolveAvatarUrl(icon);
                else if (/^\/?avatar\//i.test(icon)) icon = new URL('/' + icon.replace(/^\//, ''), 'https://appdata.chatwork.com').href;
                if (!icon) continue;
                const url = new URL(icon, window.location.href);
                if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
            } catch (_) {}
        }
        return '';
    }
    function getNotificationTarget(options, notification) {
        return resolveNotificationContext(notification, options).target;
    }

    // ── 3. Chatwork Desktop window.NotificationAPI Hook ───────────────────────
    function createChatworkNotification(arg1, arg2, arg3, options) {
        let title = '', body = '', icon = '';
        if (arg3 !== undefined) {
            icon = arg1 || ''; title = arg2 || ''; body = arg3 || '';
        } else {
            title = arg1 || ''; body = arg2 || '';
        }
        if (!icon && options && typeof options === 'object') {
            icon = options.icon || options.avatar || options.image || '';
        }
        const notification = { title, body, icon };
        initializeNativeNotification(notification, options);
        if (typeof options === 'function') notification.onclick = options;
        else if (typeof options?.onclick === 'function') notification.onclick = options.onclick;
        return notification;
    }

    let _notificationApi = {
        createNotification: createChatworkNotification,
        checkPermission: function() { return 0; },
        requestPermission: function(cb) {
            if (typeof cb === 'function') {
                try { cb(0); } catch(e) {}
            }
            return Promise.resolve(0);
        }
    };

    try {
        Object.defineProperty(window, 'NotificationAPI', {
            configurable: true,
            enumerable: true,
            get: function() { return _notificationApi; },
            set: function(val) {
                if (val && typeof val === 'object') {
                    val.createNotification = createChatworkNotification;
                    val.checkPermission = function() { return 0; };
                    val.requestPermission = function(cb) {
                        if (typeof cb === 'function') {
                            try { cb(0); } catch(e) {}
                        }
                        return Promise.resolve(0);
                    };
                }
                _notificationApi = val || _notificationApi;
            }
        });
    } catch(e) {
        window.NotificationAPI = _notificationApi;
    }

    // ── 4. Standard W3C window.Notification Polyfill ─────────────────────────
    function NativeNotificationPolyfill(title, options) {
        options = options || {};
        this.title = title;
        this.body = options.body || '';
        this.icon = options.icon || '';
        this.tag = options.tag || '';
        this.data = options.data || null;
        this.onerror = null;
        this.onshow = null;
        initializeNativeNotification(this, options);
    }

    NativeNotificationPolyfill.permission = 'granted';
    NativeNotificationPolyfill.requestPermission = function(cb) {
        if (typeof cb === 'function') {
            try { cb('granted'); } catch(e) {}
        }
        return Promise.resolve('granted');
    };
    NativeNotificationPolyfill.maxActions = 2;

    try {
        window.Notification = NativeNotificationPolyfill;
    } catch(e) {
        console.warn('[THK Native Client] Could not override window.Notification:', e);
    }

    // Hook navigator.permissions.query for notifications
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications') {
                    return Promise.resolve({
                        state: 'granted',
                        name: 'notifications',
                        onchange: null,
                        addEventListener: function() {},
                        removeEventListener: function() {},
                        dispatchEvent: function() { return true; }
                    });
                }
                return origQuery(desc);
            };
        }
    } catch(e) {}

    // ── 5. Unread Badge & Title Watcher ───────────────────────────────────────
    function extractBadgeCount(title) {
        if (!title || typeof title !== 'string') return 0;
        const m = title.match(/^\[(\d+)/);
        if (m) return parseInt(m[1], 10) || 0;
        const m2 = title.match(/^\((\d+)\)/);
        if (m2) return parseInt(m2[1], 10) || 0;
        const m3 = title.match(/\[(\d+)\]/);
        if (m3) return parseInt(m3[1], 10) || 0;
        return 0;
    }

    let lastReportedBadge = -1;
    function checkAndSendBadge(title) {
        const count = extractBadgeCount(title);
        if (count !== lastReportedBadge) {
            lastReportedBadge = count;
            console.log('[THK Native Client] Unread badge updated:', count, 'from title:', title);
            window.__chatwork_ipc.setBadge(count);
        }
    }

    try {
        const origTitleDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
        if (origTitleDesc && origTitleDesc.set) {
            Object.defineProperty(document, 'title', {
                configurable: true,
                enumerable: true,
                set: function(val) {
                    origTitleDesc.set.call(document, val);
                    checkAndSendBadge(val);
                },
                get: function() {
                    return origTitleDesc.get.call(document);
                }
            });
        }
    } catch(e) {
        console.warn('[THK Native Client] Title hook error:', e);
    }

    function setupTitleObservers() {
        checkAndSendBadge(document.title);

        const titleEl = document.querySelector('title');
        if (titleEl) {
            new MutationObserver(function() {
                checkAndSendBadge(document.title);
            }).observe(titleEl, { childList: true, characterData: true, subtree: true });
        }

        if (document.head) {
            new MutationObserver(function() {
                checkAndSendBadge(document.title);
            }).observe(document.head, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupTitleObservers);
    } else {
        setupTitleObservers();
    }

    // ── 6. Chatwork Live Call Notification Watcher ────────────────────────────
    function setupLiveCallWatcher() {
        let isCallActive = false;
        function checkLiveCall(node) {
            if (node && node.childElementCount > 0 && !isCallActive) {
                isCallActive = true;
                window.__chatwork_ipc.notify('Chatwork Live', 'Cuộc gọi Chatwork Live đang đến...');
            } else if (node && node.childElementCount === 0 && isCallActive) {
                isCallActive = false;
            }
        }

        function initLiveObserver() {
            const liveElem = document.querySelector('#_liveNotification');
            if (liveElem) {
                new MutationObserver(function() {
                    checkLiveCall(liveElem);
                }).observe(liveElem, { childList: true });
                checkLiveCall(liveElem);
            }
        }

        if (document.documentElement) {
            new MutationObserver(function() {
                initLiveObserver();
            }).observe(document.documentElement, { childList: true, subtree: true });
        }
        initLiveObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupLiveCallWatcher);
    } else {
        setupLiveCallWatcher();
    }

    // ── 7. Message links and notification navigation ─────────────────────────
    function getMessageHash(href) {
        try {
            const url = new URL(href, window.location.href);
            const host = url.hostname.toLowerCase();
            if (!['http:', 'https:'].includes(url.protocol) || !['chatwork.com', 'kcw.kddi.ne.jp', 'kcw.kddi.com']
                .some(domain => host === domain || host.endsWith('.' + domain))) return null;
            const match = url.hash.match(/^#(?:!|_)rid(\d+)(?:-(\d+))?$/);
            return match ? '#!rid' + match[1] + (match[2] ? '-' + match[2] : '') : null;
        } catch(error) { return null; }
    }
    function getRoomIdFromHash(hash) {
        return typeof hash === 'string' ? hash.match(/^#(?:!|_)rid(\d+)/)?.[1] || '' : '';
    }
    function findMessageElement(messageId) {
        return document.getElementById?.('_messageId' + messageId)
            || document.getElementById?.('_message' + messageId)
            || document.querySelector?.('[data-mid="' + messageId + '"], [data-message-id="' + messageId + '"]');
    }
    let messageNavigation = 0;
    window.__thk_navigateToMessage = function(href) {
        const hash = getMessageHash(href);
        if (!hash) return false;
        const match = hash.match(/^#!rid(\d+)(?:-(\d+))?$/);
        const roomId = match?.[1] || '';
        const messageId = match?.[2] || '';
        const navigation = ++messageNavigation;
        const applyHash = () => {
            if (window.location.hash === hash) {
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            } else {
                window.location.hash = hash;
            }
        };
        applyHash();
        if (typeof Promise === 'function') {
            Promise.resolve().then(() => {
                if (navigation !== messageNavigation) return;
                const currentRoom = getRoomIdFromHash(window.location.hash);
                if (currentRoom && currentRoom !== roomId) applyHash();
            });
        }
        if (messageId) {
            let attempts = 0;
            const scrollToMessage = () => {
                if (navigation !== messageNavigation) return;
                // Chatwork normalizes #!rid<room>-<msg> to #!rid<room> after selecting the room.
                const currentRoom = getRoomIdFromHash(window.location.hash);
                if (currentRoom && currentRoom !== roomId) return;
                const message = findMessageElement(messageId);
                if (message) {
                    message.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    if (message.classList?.add && message.classList?.remove) {
                        message.classList.remove('thk-notification-target-message');
                        void message.offsetWidth;
                        message.classList.add('thk-notification-target-message');
                        setTimeout(() => message.classList?.remove?.('thk-notification-target-message'), 2600);
                    }
                } else if (++attempts < 60) {
                    setTimeout(scrollToMessage, 100);
                }
            };
            setTimeout(scrollToMessage, 100);
        }
        return true;
    };
    function setupMessageLinkInterceptor() {
        document.addEventListener('click', function(e) {
            const link = e.target.closest?.('a');
            if (!link || !getMessageHash(link.href)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            window.__thk_navigateToMessage(link.href);
        }, true);
    }
    setupMessageLinkInterceptor();

    // ── 8. Clipboard Copy Helper ──────────────────────────────────────────────
    function copyTextToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function() {
                return fallbackCopy(text);
            });
        }
        return fallbackCopy(text);
    }

    function fallbackCopy(text) {
        return new Promise(function(resolve, reject) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try {
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                if (ok) resolve(); else reject(new Error('execCommand copy failed'));
            } catch(err) {
                document.body.removeChild(ta);
                reject(err);
            }
        });
    }

    // ── 9. CSS Styles Injection (Toolbar SAME ROW, Dropdown, Modals, Markdown) ──
    function injectThkStyles() {
        if (document.getElementById('thk-custom-styles')) return;

        const style = document.createElement('style');
        style.id = 'thk-custom-styles';
        style.textContent = `
/* ── Notification Target Message Highlight ─────────────────────────────── */
@keyframes thkNotificationPulse {
    0% { background-color: rgba(251, 191, 36, 0.36); box-shadow: inset 3px 0 0 #f59e0b; }
    65% { background-color: rgba(251, 191, 36, 0.2); box-shadow: inset 3px 0 0 #f59e0b; }
    100% { background-color: transparent; box-shadow: none; }
}
.thk-notification-target-message {
    animation: thkNotificationPulse 2.5s ease-out !important;
    border-radius: 4px !important;
}

/* ── Ensure Chatwork Toolbar Container does not clip custom items ────────── */
#_chatSendTool, .chatSendTool, .thk-native-compose-tools {
    display: flex !important;
    align-items: center !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 28px !important;
    max-height: none !important;
    flex-wrap: nowrap !important;
    width: auto !important;
}
.chatSendArea__chatSendTool {
    display: flex !important;
    align-items: center !important;
    overflow: visible !important;
    height: auto !important;
    min-height: 28px !important;
    flex-wrap: nowrap !important;
}

/* ── THK Inline Toolbar (Placed directly inside #_chatSendTool) ────────── */
.thk-toolbar-inline {
    display: inline-flex !important;
    align-items: center !important;
    gap: 3px !important;
    margin-left: 6px !important;
    padding-left: 6px !important;
    border-left: 1px solid #d0d7de !important;
    vertical-align: middle !important;
    height: 28px !important;
    flex-shrink: 0 !important;
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 10 !important;
}
.thk-icon-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 26px !important;
    height: 26px !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
    border: 1px solid transparent !important;
    border-radius: 4px !important;
    color: #4b5563 !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    outline: none !important;
    position: relative !important;
}
.thk-icon-btn:hover {
    background: #e2e8f0 !important;
    color: #1d4ed8 !important;
    border-color: #cbd5e1 !important;
}
.thk-icon-btn:active {
    transform: scale(0.93) !important;
}
.thk-icon-btn.thk-btn-req {
    color: #4f46e5 !important;
}
.thk-icon-btn.thk-btn-req:hover {
    background: #e0e7ff !important;
    color: #3730a3 !important;
    border-color: #c7d2fe !important;
}
.thk-icon-btn.thk-btn-preview {
    color: #059669 !important;
}
.thk-icon-btn.thk-btn-preview:hover {
    background: #d1fae5 !important;
    color: #047857 !important;
    border-color: #a7f3d0 !important;
}

/* ── Inline Mention Autocomplete Dropdown (Fixed on Document Body) ─────── */
.thk-mention-dropdown {
    position: fixed !important;
    max-height: 260px !important;
    overflow-y: auto !important;
    background: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 8px !important;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1) !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 13px !important;
    padding: 4px 0 !important;
    box-sizing: border-box !important;
}
.thk-mention-item {
    display: flex !important;
    align-items: center !important;
    gap: 10px !important;
    padding: 6px 12px !important;
    cursor: pointer !important;
    transition: background 0.1s ease !important;
    user-select: none !important;
}
.thk-mention-item:hover, .thk-mention-item.active {
    background: #eff6ff !important;
    color: #1d4ed8 !important;
}
.thk-mention-tagged {
    margin-left: auto !important;
    white-space: nowrap !important;
    color: #059669 !important;
    font-size: 11px !important;
    font-weight: 600 !important;
}
.thk-mention-avatar {
    width: 24px !important;
    height: 24px !important;
    border-radius: 50% !important;
    object-fit: cover !important;
    background: #cbd5e1 !important;
    flex-shrink: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    color: #ffffff !important;
}
.thk-mention-avatar-all {
    background: #10b981 !important;
}
.thk-mention-info {
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
}
.thk-mention-name {
    font-weight: 600 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    line-height: 1.3 !important;
}
.thk-mention-sub {
    font-size: 11px !important;
    color: #64748b !important;
    line-height: 1.2 !important;
}

/* ── Code Copy Button inside Pre Blocks ────────────────────────────────── */
.thk-code-container {
    position: relative !important;
}
.thk-code-copy-btn {
    position: absolute !important;
    top: 6px !important;
    right: 8px !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
    padding: 3px 8px !important;
    font-size: 11px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-weight: 500 !important;
    color: #475569 !important;
    background: rgba(255, 255, 255, 0.9) !important;
    border: 1px solid rgba(0, 0, 0, 0.12) !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    backdrop-filter: blur(4px) !important;
    transition: all 0.15s ease !important;
    opacity: 0.85 !important;
    z-index: 5 !important;
    user-select: none !important;
    line-height: 1.2 !important;
    outline: none !important;
}
.thk-code-copy-btn:hover {
    opacity: 1 !important;
    background: #ffffff !important;
    color: #0f172a !important;
    border-color: rgba(0, 0, 0, 0.25) !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08) !important;
}
.thk-code-copy-btn.copied {
    background: #10b981 !important;
    color: #ffffff !important;
    border-color: #10b981 !important;
}

/* ── Common Modal Backdrop & Container ─────────────────────────────────── */
.thk-modal-backdrop, .thk-preview-modal-backdrop {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: rgba(15, 23, 42, 0.6) !important;
    backdrop-filter: blur(5px) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    animation: thkFadeIn 0.15s ease-out;
}
@keyframes thkFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
.thk-modal-box {
    width: 620px !important;
    max-width: 94vw !important;
    background: #ffffff !important;
    border-radius: 14px !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.3) !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    color: #1e293b !important;
    border: 1px solid #e2e8f0 !important;
    animation: thkSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
.thk-preview-modal-box {
    width: 720px !important;
    max-width: 94vw !important;
    max-height: 85vh !important;
    background: #ffffff !important;
    border-radius: 14px !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.3) !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    color: #1e293b !important;
    border: 1px solid #e2e8f0 !important;
    animation: thkSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes thkSlideUp {
    from { transform: translateY(18px) scale(0.97); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
}
.thk-modal-header, .thk-preview-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 14px 20px !important;
    border-bottom: 1px solid #e2e8f0 !important;
    background: #f8fafc !important;
}
.thk-modal-title, .thk-preview-title {
    font-size: 15px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
}
.thk-preview-badge {
    font-size: 11px !important;
    font-weight: 500 !important;
    color: #64748b !important;
    background: #e2e8f0 !important;
    padding: 2px 8px !important;
    border-radius: 12px !important;
    margin-left: 6px !important;
}
.thk-modal-close, .thk-preview-close {
    background: none !important;
    border: none !important;
    font-size: 20px !important;
    line-height: 1 !important;
    color: #94a3b8 !important;
    cursor: pointer !important;
    padding: 4px 8px !important;
    border-radius: 6px !important;
    transition: all 0.15s !important;
}
.thk-modal-close:hover, .thk-preview-close:hover {
    color: #0f172a !important;
    background: #e2e8f0 !important;
}
.thk-modal-body {
    padding: 18px 22px !important;
    max-height: 72vh !important;
    overflow-y: auto !important;
}
.thk-preview-body {
    padding: 20px 24px !important;
    overflow-y: auto !important;
    flex: 1 !important;
    font-size: 14px !important;
    line-height: 1.6 !important;
    color: #1e293b !important;
    word-break: break-word !important;
    background: #ffffff !important;
}
.thk-modal-footer, .thk-preview-footer {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 12px 20px !important;
    border-top: 1px solid #e2e8f0 !important;
    background: #f8fafc !important;
}

/* ── Leave Request Form Styling ────────────────────────────────────────── */
.thk-leave-fields {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 12px !important;
}
.thk-leave-fields label { min-width: 0 !important; font-size: 12px !important; }
.thk-leave-fields input { margin-top: 4px !important; }
.thk-leave-hint { font-size: 12px !important; color: #64748b !important; }
.thk-leave-error { font-size: 12px !important; color: #dc2626 !important; }
.thk-sec-title {
    font-size: 11px !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.5px !important;
    color: #64748b !important;
    margin-bottom: 8px !important;
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
}
.thk-type-grid {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 6px !important;
    margin-bottom: 16px !important;
}
.thk-type-card {
    display: flex !important;
    flex-direction: column !important;
    padding: 8px 10px !important;
    background: #f8fafc !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    user-select: none !important;
}
.thk-type-card:hover {
    background: #f1f5f9 !important;
    border-color: #cbd5e1 !important;
    transform: translateY(-1px) !important;
}
.thk-type-card.active {
    background: #eff6ff !important;
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 1px #3b82f6 !important;
}
.thk-type-name {
    font-size: 12px !important;
    font-weight: 700 !important;
    color: #1e293b !important;
    line-height: 1.2 !important;
}
.thk-type-card.active .thk-type-name {
    color: #1d4ed8 !important;
}
.thk-type-desc {
    font-size: 10px !important;
    color: #64748b !important;
    margin-top: 2px !important;
}
.thk-chips-row {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 5px !important;
    margin-bottom: 8px !important;
}
.thk-chip-btn {
    padding: 4px 10px !important;
    font-size: 11px !important;
    font-weight: 500 !important;
    background: #f8fafc !important;
    color: #475569 !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 14px !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    user-select: none !important;
}
.thk-chip-btn:hover {
    background: #e2e8f0 !important;
    color: #0f172a !important;
}
.thk-chip-btn.active {
    background: #2563eb !important;
    color: #ffffff !important;
    border-color: #2563eb !important;
}
.thk-input-field {
    width: 100% !important;
    padding: 8px 12px !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 8px !important;
    font-size: 13px !important;
    color: #1e293b !important;
    background: #ffffff !important;
    box-sizing: border-box !important;
    outline: none !important;
    transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
    margin-bottom: 14px !important;
}
.thk-input-field:focus {
    border-color: #2563eb !important;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15) !important;
}
.thk-preview-card {
    background: #f8fafc !important;
    border: 1px solid #e2e8f0 !important;
    border-left: 4px solid #2563eb !important;
    border-radius: 8px !important;
    padding: 10px 14px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    font-size: 12px !important;
    line-height: 1.5 !important;
    color: #334155 !important;
    margin-bottom: 4px !important;
}
.thk-preview-raw {
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 11px !important;
    color: #64748b !important;
    background: #f1f5f9 !important;
    padding: 6px 10px !important;
    border-radius: 6px !important;
    margin-top: 6px !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
}

/* ── Buttons ───────────────────────────────────────────────────────────── */
.thk-btn-primary {
    background: #2563eb !important;
    color: #ffffff !important;
    border: 1px solid #2563eb !important;
    border-radius: 6px !important;
    padding: 7px 16px !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 5px !important;
}
.thk-btn-primary:hover {
    background: #1d4ed8 !important;
}
.thk-btn-success {
    background: #16a34a !important;
    color: #ffffff !important;
    border: 1px solid #16a34a !important;
    border-radius: 6px !important;
    padding: 7px 16px !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
    display: inline-flex !important;
    align-items: center !important;
    gap: 5px !important;
}
.thk-btn-success:hover {
    background: #15803d !important;
}
.thk-btn-secondary {
    background: #ffffff !important;
    color: #475569 !important;
    border: 1px solid #cbd5e1 !important;
    border-radius: 6px !important;
    padding: 7px 12px !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: all 0.15s ease !important;
}
.thk-btn-secondary:hover {
    background: #f1f5f9 !important;
    color: #0f172a !important;
}
.thk-kbd {
    display: inline-block !important;
    padding: 1px 5px !important;
    font-size: 10px !important;
    background: rgba(0, 0, 0, 0.08) !important;
    border-radius: 3px !important;
    margin-left: 4px !important;
}

/* ── Markdown & Chatwork BBCode Rendered Content ───────────────────────── */
.thk-md-h1 {
    font-size: 22px !important;
    font-weight: 700 !important;
    color: #0f172a !important;
    margin: 0 0 10px 0 !important;
    border-bottom: 1px solid #e2e8f0 !important;
    padding-bottom: 6px !important;
}
.thk-md-h2 {
    font-size: 18px !important;
    font-weight: 700 !important;
    color: #1e293b !important;
    margin: 14px 0 8px 0 !important;
    border-bottom: 1px solid #f1f5f9 !important;
    padding-bottom: 4px !important;
}
.thk-md-h3 {
    font-size: 15px !important;
    font-weight: 600 !important;
    color: #334155 !important;
    margin: 12px 0 6px 0 !important;
}
.thk-md-info {
    background: #f8fafc !important;
    border: 1px solid #cbd5e1 !important;
    border-left: 4px solid #2563eb !important;
    border-radius: 8px !important;
    margin: 10px 0 !important;
    overflow: hidden !important;
}
.thk-md-info-title {
    background: #eff6ff !important;
    color: #1d4ed8 !important;
    font-weight: 700 !important;
    font-size: 13px !important;
    padding: 8px 14px !important;
    border-bottom: 1px solid #dbeafe !important;
}
.thk-md-info-body {
    padding: 10px 14px !important;
    font-size: 13px !important;
    color: #334155 !important;
    line-height: 1.6 !important;
}
.thk-md-title {
    font-weight: 700 !important;
    color: #1d4ed8 !important;
    font-size: 14px !important;
    margin: 6px 0 !important;
}
.thk-md-code-wrap {
    margin: 10px 0 !important;
    border-radius: 8px !important;
    overflow: hidden !important;
    border: 1px solid #334155 !important;
    background: #0f172a !important;
}
.thk-md-code-header {
    background: #1e293b !important;
    color: #94a3b8 !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    padding: 4px 12px !important;
    text-transform: uppercase !important;
    letter-spacing: 0.5px !important;
    border-bottom: 1px solid #334155 !important;
}
.thk-md-code-block {
    margin: 0 !important;
    padding: 12px 14px !important;
    background: #0f172a !important;
    color: #f1f5f9 !important;
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 12px !important;
    line-height: 1.5 !important;
    overflow-x: auto !important;
}
.thk-md-inline-code {
    background: #f1f5f9 !important;
    color: #dc2626 !important;
    font-family: SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    font-size: 12px !important;
    padding: 2px 6px !important;
    border-radius: 4px !important;
    border: 1px solid #e2e8f0 !important;
}
.thk-md-mention {
    display: inline-flex !important;
    align-items: center !important;
    gap: 4px !important;
    background: #eff6ff !important;
    color: #1d4ed8 !important;
    border: 1px solid #bfdbfe !important;
    border-radius: 12px !important;
    padding: 1px 8px !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    vertical-align: middle !important;
    user-select: none !important;
}
.thk-md-hr {
    border: none !important;
    border-top: 1px dashed #cbd5e1 !important;
    margin: 16px 0 !important;
}
.thk-md-quote {
    margin: 10px 0 !important;
    padding: 8px 14px !important;
    border-left: 4px solid #94a3b8 !important;
    background: #f8fafc !important;
    color: #475569 !important;
    font-style: italic !important;
    border-radius: 0 6px 6px 0 !important;
}
.thk-md-ul {
    margin: 6px 0 6px 20px !important;
    padding: 0 !important;
}
.thk-md-li {
    margin-bottom: 3px !important;
    line-height: 1.5 !important;
}
.thk-md-link {
    color: #2563eb !important;
    text-decoration: underline !important;
}
.thk-md-empty {
    color: #94a3b8 !important;
    font-style: italic !important;
    text-align: center !important;
    padding: 30px 10px !important;
}
.thk-md-gap {
    height: 10px !important;
}

/* ── Dark Theme Support ──────────────────────────────────────────────── */
@media (prefers-color-scheme: dark), [data-theme="dark"] {
    .thk-toolbar-inline {
        border-left-color: #373e47 !important;
    }
    .thk-icon-btn {
        color: #adbac7 !important;
    }
    .thk-icon-btn:hover {
        background: rgba(255, 255, 255, 0.1) !important;
        color: #58a6ff !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
    }
    .thk-icon-btn.thk-btn-req {
        color: #818cf8 !important;
    }
    .thk-icon-btn.thk-btn-req:hover {
        background: #1e1b4b !important;
        color: #a5b4fc !important;
        border-color: #4338ca !important;
    }
    .thk-icon-btn.thk-btn-preview {
        color: #34d399 !important;
    }
    .thk-icon-btn.thk-btn-preview:hover {
        background: #064e3b !important;
        color: #6ee7b7 !important;
        border-color: #059669 !important;
    }
    .thk-mention-dropdown {
        background: #1e293b !important;
        border-color: #334155 !important;
        color: #f1f5f9 !important;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5) !important;
    }
    .thk-mention-item:hover, .thk-mention-item.active {
        background: #334155 !important;
        color: #60a5fa !important;
    }
    .thk-mention-sub {
        color: #94a3b8 !important;
    }
    .thk-modal-box, .thk-preview-modal-box {
        background: #0f172a !important;
        color: #f1f5f9 !important;
        border-color: #334155 !important;
    }
    .thk-modal-header, .thk-modal-footer, .thk-preview-header, .thk-preview-footer {
        background: #1e293b !important;
        border-color: #334155 !important;
    }
    .thk-modal-title, .thk-preview-title {
        color: #f8fafc !important;
    }
    .thk-preview-body {
        background: #0f172a !important;
        color: #f1f5f9 !important;
    }
    .thk-type-card {
        background: #1e293b !important;
        border-color: #334155 !important;
    }
    .thk-type-card:hover {
        background: #273549 !important;
    }
    .thk-type-card.active {
        background: #1e3a8a !important;
        border-color: #60a5fa !important;
    }
    .thk-type-name {
        color: #f1f5f9 !important;
    }
    .thk-type-card.active .thk-type-name {
        color: #93c5fd !important;
    }
    .thk-type-desc {
        color: #94a3b8 !important;
    }
    .thk-chip-btn {
        background: #1e293b !important;
        color: #cbd5e1 !important;
        border-color: #334155 !important;
    }
    .thk-chip-btn:hover {
        background: #334155 !important;
        color: #ffffff !important;
    }
    .thk-input-field {
        background: #1e293b !important;
        border-color: #334155 !important;
        color: #f1f5f9 !important;
    }
    .thk-preview-card {
        background: #1e293b !important;
        border-color: #334155 !important;
        color: #cbd5e1 !important;
    }
    .thk-preview-raw {
        background: #0f172a !important;
        color: #94a3b8 !important;
    }
    .thk-btn-secondary {
        background: #1e293b !important;
        color: #cbd5e1 !important;
        border-color: #334155 !important;
    }
    .thk-btn-secondary:hover {
        background: #334155 !important;
        color: #ffffff !important;
    }
    .thk-code-copy-btn {
        background: rgba(30, 41, 59, 0.9) !important;
        color: #cbd5e1 !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
    }
    .thk-code-copy-btn:hover {
        background: #334155 !important;
        color: #ffffff !important;
    }
    .thk-md-info {
        background: #1e293b !important;
        border-color: #334155 !important;
    }
    .thk-md-info-title {
        background: #1e3a8a !important;
        color: #93c5fd !important;
        border-bottom-color: #1d4ed8 !important;
    }
    .thk-md-info-body {
        color: #cbd5e1 !important;
    }
    .thk-md-h1, .thk-md-h2, .thk-md-h3 {
        color: #f8fafc !important;
        border-color: #334155 !important;
    }
    .thk-md-quote {
        background: #1e293b !important;
        color: #cbd5e1 !important;
        border-left-color: #64748b !important;
    }
}
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectThkStyles);
    } else {
        injectThkStyles();
    }

    // ── 10. Text Formatting Helpers (WITH NEWLINES FOR SHORTCUTS) ─────────────
    function getChatText() {
        return document.querySelector('#_chatText')
            || document.querySelector('#CurrentSelectedRoom textarea')
            || document.querySelector('#_chatSendArea textarea');
    }

    function getFormattingEditor() {
        const active = document.activeElement;
        if (active?.tagName === 'TEXTAREA' && !active.disabled && !active.readOnly
            && !active.closest?.('#thk-modal-backdrop, #thk-preview-modal-backdrop, #thk-toolkit-panel')) return active;
        return getChatText();
    }
    window.__thk_getChatText = getChatText;

    function setChatTextValue(chatText, value) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype || {}, 'value')?.set;
        if (setter) setter.call(chatText, value); else chatText.value = value;
    }

    function insertTextAtRange(start, end, replacement, cursorOffset, editor) {
        const chatText = editor || getFormattingEditor();
        if (!chatText) return;
        chatText.focus();

        const val = chatText.value;
        const newCursorPos = start + (cursorOffset !== undefined ? cursorOffset : replacement.length);

        let execSuccess = false;
        try {
            chatText.setSelectionRange(start, end);
            execSuccess = document.execCommand('insertText', false, replacement);
        } catch(e) {}

        if (!execSuccess) {
            setChatTextValue(chatText, val.substring(0, start) + replacement + val.substring(end));
            chatText.dispatchEvent(new Event('input', { bubbles: true }));
            chatText.dispatchEvent(new Event('change', { bubbles: true }));
        }

        chatText.setSelectionRange(newCursorPos, newCursorPos);
    }

    // [info] tag with content on new lines
    function wrapInfo(hasTitle) {
        const chatText = getFormattingEditor();
        if (!chatText) return;
        chatText.focus();

        const start = chatText.selectionStart;
        const end = chatText.selectionEnd;
        const val = chatText.value;
        const selected = val.substring(start, end).trim();

        let replacement = '';
        let cursorOffset = 0;

        if (hasTitle) {
            if (selected) {
                replacement = `[info]\n[title]Tiêu đề[/title]\n${selected}\n[/info]\n`;
                cursorOffset = '[info]\n[title]'.length;
            } else {
                replacement = `[info]\n[title]Tiêu đề[/title]\nNội dung\n[/info]\n`;
                cursorOffset = '[info]\n[title]'.length;
            }
        } else {
            if (selected) {
                replacement = `[info]\n${selected}\n[/info]\n`;
                cursorOffset = replacement.length;
            } else {
                replacement = `[info]\n\n[/info]\n`;
                cursorOffset = '[info]\n'.length; // cursor between newlines
            }
        }

        insertTextAtRange(start, end, replacement, cursorOffset, chatText);
    }

    // [code] tag with content on new lines
    function wrapCode() {
        const chatText = getFormattingEditor();
        if (!chatText) return;
        chatText.focus();

        const start = chatText.selectionStart;
        const end = chatText.selectionEnd;
        const val = chatText.value;
        const selected = val.substring(start, end).trim();

        let replacement = '';
        let cursorOffset = 0;

        if (selected) {
            replacement = `[code]\n${selected}\n[/code]\n`;
            cursorOffset = replacement.length;
        } else {
            replacement = `[code]\n\n[/code]\n`;
            cursorOffset = '[code]\n'.length; // cursor between newlines
        }

        insertTextAtRange(start, end, replacement, cursorOffset, chatText);
    }

    // [hr] tag with newlines
    function insertHr() {
        const chatText = getFormattingEditor();
        if (!chatText) return;
        chatText.focus();

        const start = chatText.selectionStart;
        const end = chatText.selectionEnd;
        const val = chatText.value;

        const pre = (start > 0 && val[start - 1] !== '\n') ? '\n' : '';
        const post = (end < val.length && val[end] !== '\n') ? '\n' : '\n';
        const replacement = `${pre}[hr]${post}`;

        insertTextAtRange(start, end, replacement, replacement.length, chatText);
    }

    function insertMentionAll() {
        const chatText = getChatText();
        if (!chatText) return;
        const start = chatText.selectionStart;
        const end = chatText.selectionEnd;
        insertTextAtRange(start, end, '[To:all] ALL\n', '[To:all] ALL\n'.length);
    }

    // ── 11. Room Members & Inline Mention Autocomplete ─────────────────────────
    function normalizeSearch(str) {
        return String(str || '').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
    }

    function getRoomMembers() {
        const modernMembers = window.__thkToolkit?.getRoomMembers();
        if (modernMembers !== null && modernMembers !== undefined) return modernMembers;
        const list = [];
        const seen = new Set();
        const rid = window.location.hash.match(/rid(\d+)/)?.[1]
            || window.RM?.id || window.CW?.roomId;
        const add = (id, name, avatar) => {
            id = String(id || '');
            if (!/^\d+$/.test(id) || !name || seen.has(id)) return;
            seen.add(id);
            list.push({ id, name: String(name), avatar: avatar || '' });
        };
        // Only use accounts belonging to this room, never the global account cache.
        let memberIds = null;
        try {
            const rm = window.RM;
            if (rm && rid) {
                memberIds = typeof rm.getMemberList === 'function' ? rm.getMemberList(rid) : null;
                memberIds = memberIds || rm.member_dat?.[rid] || rm.room_dat?.[rid]?.members;
                if (memberIds) {
                    const entries = Array.isArray(memberIds) ? memberIds : Object.keys(memberIds);
                    entries.forEach(member => {
                        const id = String(typeof member === 'object' ? member.aid || member.account_id || member.id : member);
                        const account = window.AC?.account_dat?.[id];
                        add(id, window.AC?.getName?.(id) || account?.name || member.name,
                            window.AC?.getAvatar?.(id) || account?.avatar_image_src || member.avatar);
                    });
                }
            }
        } catch(e) {}
        // The native TO picker and room sidebar provide a DOM fallback.
        // Timeline authors and other rooms' cached accounts are not membership lists.
        if (!memberIds) {
            document.querySelectorAll('#_toMemberList li, .roomMember__item').forEach(el => {
                const accountEl = el.matches('[data-aid], [data-cwlib-account-id], [data-cwlib-member-id]')
                    ? el : el.querySelector('[data-aid], [data-cwlib-account-id], [data-cwlib-member-id]');
                const id = accountEl?.getAttribute('data-cwlib-account-id')
                    || accountEl?.getAttribute('data-cwlib-member-id') || accountEl?.getAttribute('data-aid');
                const name = el.querySelector('._toMemberName, .name, .roomMember__name')?.textContent?.trim();
                add(id, name, el.querySelector('img')?.src);
            });
        }
        return list;
    }

    function getTaggedMemberIds(text) {
        return new Set(Array.from(text.matchAll(/\[To:(all|\d+)\]/g), match => match[1]));
    }

    let mentionDropdownEl = null;
    let mentionActiveIndex = 0;
    let mentionFilteredList = [];
    let mentionTokenStart = -1;
    let mentionQuery = '';
    let mentionRoomId = '';

    function closeMentionDropdown() {
        if (mentionDropdownEl) {
            mentionDropdownEl.remove();
            mentionDropdownEl = null;
        }
        mentionFilteredList = [];
        mentionActiveIndex = 0;
        mentionTokenStart = -1;
        mentionQuery = '';
    }

    function selectMentionItem(item) {
        const chatText = getChatText();
        if (!chatText || mentionTokenStart === -1) return;
        if (window.location.hash !== mentionRoomId) { closeMentionDropdown(); return; }

        const cursorPos = chatText.selectionStart;
        let replacement = '';
        if (item.isAll) {
            replacement = '[To:all] ALL\n';
        } else {
            replacement = `[To:${item.id}] ${item.name}\n`;
        }

        const tokenStart = mentionTokenStart;
        closeMentionDropdown();
        insertTextAtRange(tokenStart, cursorPos, replacement, replacement.length);
    }

    function renderMentionDropdown(items) {
        const chatText = getChatText();
        if (!chatText) return;

        if (!mentionDropdownEl) {
            mentionDropdownEl = document.createElement('div');
            mentionDropdownEl.className = 'thk-mention-dropdown';
            document.body.appendChild(mentionDropdownEl);
        }

        // Calculate fixed position anchored above chatText
        const rect = chatText.getBoundingClientRect();
        mentionDropdownEl.style.position = 'fixed';
        mentionDropdownEl.style.left = `${Math.max(12, rect.left)}px`;
        mentionDropdownEl.style.bottom = `${Math.max(10, window.innerHeight - rect.top + 6)}px`;
        mentionDropdownEl.style.width = `${Math.min(360, Math.max(280, rect.width - 24))}px`;
        mentionDropdownEl.style.zIndex = '2147483647';

        mentionFilteredList = items;
        if (mentionActiveIndex >= items.length) {
            mentionActiveIndex = 0;
        }

        mentionDropdownEl.innerHTML = '';
        mentionDropdownEl.setAttribute('role', 'listbox');
        mentionDropdownEl.setAttribute('aria-label', 'Tag thành viên');
        const taggedIds = getTaggedMemberIds(chatText.value);

        items.forEach(function(item, idx) {
            const div = document.createElement('div');
            div.className = 'thk-mention-item' + (idx === mentionActiveIndex ? ' active' : '');

            const tagged = taggedIds.has(item.id);
            div.classList.toggle('tagged', tagged);
            div.setAttribute('role', 'option');
            div.setAttribute('aria-selected', String(idx === mentionActiveIndex));
            const avatarUrl = window.__thkToolkit?.resolveAvatarUrl ? window.__thkToolkit.resolveAvatarUrl(item.avatar) : (typeof item.avatar === 'string' ? item.avatar : '');
            const avatar = document.createElement(avatarUrl && !item.isAll ? 'img' : 'div');
            avatar.className = 'thk-mention-avatar' + (item.isAll ? ' thk-mention-avatar-all' : '');
            if (avatar.tagName === 'IMG') {
                avatar.src = avatarUrl; avatar.alt = ''; avatar.loading = 'lazy'; avatar.decoding = 'async';
                avatar.addEventListener('error', () => {
                    const fallback = document.createElement('div'); fallback.className = 'thk-mention-avatar';
                    fallback.textContent = (item.name || '?')[0].toUpperCase(); avatar.replaceWith(fallback);
                }, { once: true });
            }
            else avatar.textContent = item.isAll ? '@' : (item.name || '?')[0].toUpperCase();
            const info = document.createElement('div');
            info.className = 'thk-mention-info';
            const name = document.createElement('span');
            name.className = 'thk-mention-name';
            name.textContent = item.isAll ? (window.__thkToolkit?.translate(item.name) || item.name) : item.name;
            const sub = document.createElement('span');
            sub.className = 'thk-mention-sub';
            sub.textContent = item.isAll ? 'Gửi thông báo tới cả phòng' : 'ID: ' + item.id;
            info.append(name, sub);
            div.append(avatar, info);
            if (tagged) {
                const badge = document.createElement('span');
                badge.className = 'thk-mention-tagged';
                badge.textContent = '✓ Đã tag';
                div.appendChild(badge);
            }

            div.addEventListener('mousedown', function(e) {
                e.preventDefault();
                selectMentionItem(item);
            });

            mentionDropdownEl.appendChild(div);
        });

        const activeItemEl = mentionDropdownEl.children[mentionActiveIndex];
        if (activeItemEl) {
            activeItemEl.scrollIntoView({ block: 'nearest' });
        }


    }

    function checkMentionTrigger() {
        const chatText = getChatText();
        if (!chatText || document.activeElement !== chatText) {
            closeMentionDropdown();
            return;
        }

        const cursorPos = chatText.selectionStart;
        const textBefore = chatText.value.substring(0, cursorPos);

        const atIdx = textBefore.lastIndexOf('@');
        if (atIdx === -1) {
            closeMentionDropdown();
            return;
        }

        if (atIdx > 0 && !/\s/.test(textBefore[atIdx - 1])) {
            closeMentionDropdown();
            return;
        }

        const query = textBefore.substring(atIdx + 1);
        if (/[\r\n\[\]@]/.test(query) || chatText.selectionStart !== chatText.selectionEnd) {
            closeMentionDropdown();
            return;
        }

        if (mentionTokenStart !== atIdx || mentionQuery !== query) mentionActiveIndex = 0;
        mentionTokenStart = atIdx;
        mentionQuery = query;
        mentionRoomId = window.location.hash;
        const normQuery = normalizeSearch(query);
        const allMembers = getRoomMembers();
        const results = [];

        if (!normQuery || 'all'.includes(normQuery) || 'tat ca'.includes(normQuery)) {
            results.push({ isAll: true, id: 'all', name: '@ALL (Tất cả thành viên)' });
        }

        allMembers.forEach(function(m) {
            if (!normQuery || normalizeSearch(m.name).includes(normQuery) || m.id.includes(normQuery)) {
                results.push(m);
            }
        });

        if (results.length > 0) {
            renderMentionDropdown(results);
        } else {
            closeMentionDropdown();
        }
    }

    // ── 12. Quick Action Toolbar (SAME ROW WITH CHATWORK TOOLS) ───────────────
    const formattingIcons = [
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="7" y1="6" x2="13" y2="6"></line><line x1="7" y1="14" x2="17" y2="14"></line></svg>',
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>',
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="3 2"></line></svg>',
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
    ];
    function createToolbarElement(isLi) {
        const group = document.createElement(isLi ? 'li' : 'div');
        group.id = 'thk-toolbar-inline';
        group.className = 'thk-toolbar-inline' + (isLi ? ' chatSendTool__item' : '');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Chức năng soạn tin');
        group.addEventListener('mousedown', e => e.preventDefault());
        group.innerHTML = `
            <button type="button" class="thk-icon-btn" id="thkBtnInfo" title="Thẻ Info (Ctrl+I / Cmd+I)">
                ${formattingIcons[0]}
            </button>
            <button type="button" class="thk-icon-btn" id="thkBtnInfoTitle" title="Thẻ Info có Tiêu đề (Ctrl+Shift+I / Cmd+Shift+I)">
                ${formattingIcons[1]}
            </button>
            <button type="button" class="thk-icon-btn" id="thkBtnCode" title="Thẻ Code (Ctrl+K / Cmd+K)">
                ${formattingIcons[2]}
            </button>
            <button type="button" class="thk-icon-btn" id="thkBtnHr" title="Đường kẻ ngang [hr] (Ctrl+H / Cmd+H)">
                ${formattingIcons[3]}
            </button>
            <button type="button" class="thk-icon-btn thk-btn-req" id="thkBtnLeaveRequest" title="Tạo đơn nghỉ / Báo bận (Ctrl+Shift+L / Cmd+Shift+L)">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>
            </button>
            <button type="button" class="thk-icon-btn thk-btn-preview" id="thkBtnMarkdownPreview" title="Xem trước tin nhắn (Ctrl+Shift+P / Cmd+Shift+P)">
                ${formattingIcons[4]}
            </button>
            <button type="button" class="thk-icon-btn thk-btn-translate-page" id="thkBtnTranslatePage" title="Dịch toàn bộ trang sang tiếng Việt (Ctrl+Shift+T / Cmd+Shift+T)" aria-label="Dịch toàn bộ trang sang tiếng Việt" aria-pressed="false">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            </button>
        `;

        group.querySelector('#thkBtnInfo').addEventListener('click', () => wrapInfo(false));
        group.querySelector('#thkBtnInfoTitle').addEventListener('click', () => wrapInfo(true));
        group.querySelector('#thkBtnCode').addEventListener('click', wrapCode);
        group.querySelector('#thkBtnHr').addEventListener('click', insertHr);
        group.querySelector('#thkBtnLeaveRequest').addEventListener('click', openLeaveRequestModal);
        group.querySelector('#thkBtnMarkdownPreview').addEventListener('click', openMarkdownPreviewModal);
        const transBtn = group.querySelector('#thkBtnTranslatePage');
        if (transBtn) {
            if (window.__thkIsFullPageTranslateActive?.()) {
                transBtn.classList.add('active');
                transBtn.setAttribute('aria-pressed', 'true');
                transBtn.title = 'Tắt dịch toàn bộ trang (Ctrl+Shift+T / Cmd+Shift+T)';
            }
            transBtn.addEventListener('click', () => {
                window.__thkToggleFullPageTranslation?.();
            });
        }

        return group;
    }

    function setupQuickToolbar() {
        const existing = document.getElementById('thk-toolbar-inline');
        let container = document.querySelector('#_chatSendTool, .chatSendTool, .chatSendArea__chatSendTool');
        if (!container) {
            const room = document.getElementById('CurrentSelectedRoom');
            const emoji = room && [...room.querySelectorAll('button')].find(button =>
                /^(Emoji|絵文字)(\s|\s*:|$)/i.test(button.getAttribute('aria-label') || button.title || button.querySelector('img')?.alt || button.textContent.trim()));
            container = emoji?.closest('ul, ol, [role="toolbar"]') || emoji?.parentElement;
        }
        if (!container) return; // Wait for the native toolbar; never create a separate strip.
        const sendTool = container.matches('ul, ol') ? container
            : container.querySelector('ul, ol') || container;
        if (existing && existing.parentNode === sendTool) return;
        sendTool.classList.add('thk-native-compose-tools');
        const isList = sendTool.matches('ul, ol');
        if (existing && (existing.tagName === 'LI') === isList) {
            sendTool.appendChild(existing);
        } else {
            existing?.remove();
            sendTool.appendChild(createToolbarElement(isList));
        }
    }

    const descriptionToolbars = new Map();
    const descriptionFieldLayouts = new Map(), descriptionFieldHosts = new Map();
    function restoreDescriptionField(editor, original) {
        for (const [property, saved] of original) {
            if (saved.value) editor.style.setProperty(property, saved.value, saved.priority);
            else editor.style.removeProperty(property);
        }
    }
    function layoutDescriptionField(toolbar, editor) {
        let original = descriptionFieldLayouts.get(editor);
        if (!original) {
            original = new Map(['height','padding-top','box-sizing'].map(property => [property,
                {value:editor.style.getPropertyValue(property), priority:editor.style.getPropertyPriority(property)}]));
            descriptionFieldLayouts.set(editor, original);
        }
        // Measure the native field without accumulating padding on observer passes.
        restoreDescriptionField(editor, original);
        const parent = editor.parentElement;
        if (getComputedStyle(parent).position === 'static') {
            if (!descriptionFieldHosts.has(parent)) descriptionFieldHosts.set(parent,
                {value:parent.style.getPropertyValue('position'), priority:parent.style.getPropertyPriority('position')});
            parent.style.setProperty('position', 'relative');
        }
        const bounds = editor.getBoundingClientRect(), parentBounds = parent.getBoundingClientRect();
        const computed = getComputedStyle(editor);
        toolbar.classList.add('thk-description-field-toolbar');
        toolbar.style.left = (bounds.left - parentBounds.left + parent.scrollLeft - parent.clientLeft) + 'px';
        toolbar.style.top = (bounds.top - parentBounds.top + parent.scrollTop - parent.clientTop) + 'px';
        toolbar.style.width = bounds.width + 'px';
        const toolbarHeight = toolbar.getBoundingClientRect().height;
        // The toolbar occupies the top of the existing textarea instead of adding
        // a new row to Chatwork's fixed-height group settings form.
        if (computed.boxSizing !== 'border-box') editor.style.setProperty('height', bounds.height + 'px', 'important');
        editor.style.setProperty('box-sizing', 'border-box', 'important');
        editor.style.setProperty('padding-top', ((parseFloat(computed.paddingTop) || 0) + toolbarHeight) + 'px', 'important');
    }
    const descriptionPopupTitles = '.sc-iHmpnF.eiYmEZ, [class*="modal"][class*="title"], [class*="modal"][class*="Title"], [class*="dialog"][class*="title"], [class*="dialog"][class*="Title"], [role="heading"], h1, h2, h3';
    function getRoomDescriptionEditor(header) {
        const available = editor => editor && document.body.contains(editor) && editor !== getChatText() && !editor.disabled && !editor.readOnly && !editor.hidden
            && !editor.closest('#thk-modal-backdrop, #thk-preview-modal-backdrop, #thk-toolkit-panel, [hidden], [aria-hidden="true"]')
            && editor.getClientRects().length > 0;
        if (header.tagName === 'TEXTAREA') return available(header) ? header : null;
        // Find the editor in the same popup as its title, including portal dialogs
        // whose generated classes do not expose a dialog role.
        for (let scope = header.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
            if (scope.matches('#CurrentSelectedRoom, #_sideContent, #_roomListArea, aside, main, #thk-modal-backdrop, #thk-preview-modal-backdrop, #thk-toolkit-panel')) break;
            const editors = [...scope.querySelectorAll('textarea')].filter(available);
            if (editors.length === 1) return editors[0];
        }
        return null;
    }

    function descriptionText(input) {
        return String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').normalize('NFC').trim().toLowerCase();
    }
    function isGroupDescriptionField(editor) {
        const popup = editor.closest('[role="dialog"], [aria-modal="true"], #RootModalsEntryPoint, #ModalDialogs');
        if (!popup) return false;
        const settingsTitle = /group.*(?:chat|settings)|(?:chat|settings).*group|cai dat.*(?:tro chuyen|nhom)|グループ.*設定|チャット.*設定/;
        if (!settingsTitle.test(descriptionText(popup.getAttribute('aria-label')))
            && ![...popup.querySelectorAll(descriptionPopupTitles)].some(title => title.getClientRects().length > 0 && settingsTitle.test(descriptionText(title.textContent)))) return false;
        const isCaption = input => /^(?:(?:group\s+)?description|mo ta(?: nhom)?|概要|説明)\s*[:：]?$/.test(descriptionText(input));
        if (isCaption(editor.getAttribute('aria-label'))) return true;
        const labelled = (editor.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
        if (labelled.some(id => isCaption(document.getElementById(id)?.textContent))) return true;
        if (editor.id && [...popup.querySelectorAll('label[for]')].some(label => label.getAttribute('for') === editor.id && isCaption(label.textContent))) return true;
        // Some native settings forms expose a caption next to an unlabelled textarea.
        for (let scope = editor.parentElement; scope && popup.contains(scope); scope = scope.parentElement) {
            if (scope.querySelectorAll('textarea').length > 1) break;
            if ([...scope.querySelectorAll('label, legend, dt, span, p, div')].some(label => !label.contains(editor) && isCaption(label.textContent))) return true;
            if (scope === popup) break;
        }
        return false;
    }
    function setupDescriptionToolbar() {
        const language = window.__thkToolkit?.getLanguage() || (navigator.language || 'en').slice(0, 2);
        const labels = {
            vi: ['Định dạng mô tả nhóm', 'Info', 'Tiêu đề', 'Code', 'Đường kẻ', 'Xem trước'],
            en: ['Group description formatting', 'Info', 'Title', 'Code', 'Divider', 'Preview'],
            ja: ['グループ概要の書式', 'Info', 'タイトル', 'Code', '区切り線', 'プレビュー']
        }[language] || ['Group description formatting', 'Info', 'Title', 'Code', 'Divider', 'Preview'];
        const activeTitles = new Set();
        const activeEditors = new Set(), activeFields = new Set();
        const titles = [...document.querySelectorAll(descriptionPopupTitles)].filter(header => /description|mo ta|概要|説明/.test(descriptionText(header.textContent)));
        const fields = [...document.querySelectorAll('textarea')].filter(isGroupDescriptionField);
        [...titles, ...fields].forEach(header => {
            const editor = getRoomDescriptionEditor(header);
            if (!editor || activeEditors.has(editor)) return;
            activeEditors.add(editor); activeTitles.add(header);
            let toolbar = descriptionToolbars.get(header);
            if (!toolbar) {
                toolbar = document.createElement('span');
                toolbar.className = 'thk-description-toolbar';
                toolbar.setAttribute('role', 'group');
                toolbar.addEventListener('mousedown', event => event.preventDefault());
                const actions = [() => wrapInfo(false), () => wrapInfo(true), wrapCode, insertHr, openMarkdownPreviewModal];
                actions.forEach((action, index) => {
                    const control = document.createElement('button');
                    control.type = 'button'; control.className = 'thk-icon-btn thk-description-shortcut';
                    control.innerHTML = formattingIcons[index];
                    control.addEventListener('click', event => {
                        event.preventDefault(); event.stopPropagation();
                        // Resolve again after React rerenders; never fall back to the chat draft.
                        const target = getRoomDescriptionEditor(header);
                        if (!target) return;
                        target.focus(); action();
                    });
                    toolbar.appendChild(control);
                });
                descriptionToolbars.set(header, toolbar);
            }
            if (toolbar.getAttribute('aria-label') !== labels[0]) toolbar.setAttribute('aria-label', labels[0]);
            [...toolbar.children].forEach((control, index) => {
                if (control.title !== labels[index + 1]) control.title = labels[index + 1];
                if (control.getAttribute('aria-label') !== labels[index + 1]) control.setAttribute('aria-label', labels[index + 1]);
            });
            if (header === editor) {
                if (toolbar.parentElement !== editor.parentElement || toolbar.nextElementSibling !== editor) editor.before(toolbar);
                activeFields.add(editor); layoutDescriptionField(toolbar, editor);
            } else {
                let anchor = header;
                while (anchor.parentElement && !anchor.parentElement.contains(editor)) anchor = anchor.parentElement;
                if (toolbar.parentElement !== anchor.parentElement || anchor.nextElementSibling !== toolbar) anchor.after(toolbar);
            }
        });
        for (const [header, toolbar] of descriptionToolbars) {
            if (!activeTitles.has(header)) { toolbar.remove(); descriptionToolbars.delete(header); }
        }
        for (const [editor, original] of descriptionFieldLayouts) if (!activeFields.has(editor)) {
            restoreDescriptionField(editor, original); descriptionFieldLayouts.delete(editor);
        }
        for (const [host, original] of descriptionFieldHosts) if (![...activeFields].some(editor => editor.parentElement === host)) {
            if (original.value) host.style.setProperty('position', original.value, original.priority); else host.style.removeProperty('position');
            descriptionFieldHosts.delete(host);
        }
    }

    // ── 13. Keyboard Shortcuts & Mention Navigation ───────────────────────────
    function setupChatKeyBindings() {
        document.addEventListener('thk-members-ready', checkMentionTrigger);
        document.addEventListener('input', function(e) {
            if (e.target && e.target === getChatText()) {
                if (!e.isComposing) checkMentionTrigger();
            }
        });
        document.addEventListener('compositionend', e => {
            if (e.target === getChatText()) checkMentionTrigger();
        });
        document.addEventListener('keyup', e => {
            if (e.target === getChatText() && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) checkMentionTrigger();
        });
        window.addEventListener('hashchange', closeMentionDropdown);
        document.addEventListener('focusin', e => {
            if (e.target !== getChatText()) closeMentionDropdown();
        });

        document.addEventListener('click', function(e) {
            if (e.target === getChatText()) { checkMentionTrigger(); return; }
            if (e.target.closest?.('#thkBtnMention')) return;
            if (mentionDropdownEl && !mentionDropdownEl.contains(e.target)) {
                closeMentionDropdown();
            }
        });

        document.addEventListener('keydown', function(e) {
            const chatText = getChatText();
            const isChatFocused = (document.activeElement === chatText);
            const formattingEditor = getFormattingEditor();
            const isFormattingFocused = document.activeElement === formattingEditor;

            // Handle dropdown navigation when mention popup is open
            if (e.isComposing) return;
            if (isChatFocused && mentionDropdownEl && mentionFilteredList.length > 0) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    mentionActiveIndex = (mentionActiveIndex + 1) % mentionFilteredList.length;
                    renderMentionDropdown(mentionFilteredList);
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    mentionActiveIndex = (mentionActiveIndex - 1 + mentionFilteredList.length) % mentionFilteredList.length;
                    renderMentionDropdown(mentionFilteredList);
                    return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    selectMentionItem(mentionFilteredList[mentionActiveIndex]);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeMentionDropdown();
                    return;
                }
            }

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const modKey = isMac ? e.metaKey : e.ctrlKey;

            // Check if custom shortcut configured via toolkit matches
            if (window.__thk_matchCustomShortkey && window.__thk_matchCustomShortkey(e)) {
                return;
            }

            // Global shortcut: Ctrl+Shift+L / Cmd+Shift+L / Alt+L -> Leave Request
            if ((modKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) || (e.altKey && (e.key === 'L' || e.key === 'l'))) {
                e.preventDefault();
                openLeaveRequestModal();
                return;
            }

            // Global shortcut: Ctrl+Shift+P / Cmd+Shift+P -> Markdown Preview
            if (modKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
                e.preventDefault();
                openMarkdownPreviewModal();
                return;
            }

            // Global shortcut: Ctrl+Shift+T / Cmd+Shift+T -> Toggle Full Page Translation
            if (modKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
                e.preventDefault();
                window.__thkToggleFullPageTranslation?.();
                return;
            }

            if (isFormattingFocused && modKey) {
                // Ctrl+I / Cmd+I -> Info
                if (e.key === 'i' || e.key === 'I') {
                    e.preventDefault();
                    wrapInfo(e.shiftKey);
                    return;
                }

                // Ctrl+K / Cmd+K -> Code
                if (e.key === 'k' || e.key === 'K') {
                    e.preventDefault();
                    wrapCode();
                    return;
                }

                // Ctrl+H / Cmd+H -> Hr
                if (e.key === 'h' || e.key === 'H') {
                    e.preventDefault();
                    insertHr();
                    return;
                }

                // Ctrl+M / Cmd+M -> Mention @
                if (isChatFocused && (e.key === 'm' || e.key === 'M')) {
                    e.preventDefault();
                    const pos = chatText.selectionStart;
                    const pre = (pos > 0 && !/\s/.test(chatText.value[pos - 1])) ? ' @' : '@';
                    insertTextAtRange(pos, pos, pre, pre.length);
                    checkMentionTrigger();
                    return;
                }
            }
        }, true);
    }
    setupChatKeyBindings();

    // ── 14. Redesigned Modern Leave Request Modal ─────────────────────────────
    function formatLeaveDate(date) {
        return date.split('-').reverse().join('/');
    }
    function getLeaveDateRange(start, end) {
        const parse = value => {
            const date = new Date(value + 'T00:00:00Z');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
                || date.toISOString().slice(0, 10) !== value) throw new Error('Vui lòng chọn ngày hợp lệ.');
            return date;
        };
        const first = parse(start), last = parse(end);
        if (last < first) throw new Error('Ngày kết thúc phải từ ngày bắt đầu trở đi.');
        if ((last-first)/86400000 >= 366) throw new Error('Chỉ chọn tối đa 366 ngày trong một lần.');
        const dates = [];
        for (const date = new Date(first); date <= last; date.setUTCDate(date.getUTCDate() + 1)) dates.push(date.toISOString().slice(0, 10));
        return dates;
    }
    function getLeaveSlots(dates, start, end) {
        return dates.map(value => typeof value === 'string' ? { date:value,start,end } : value);
    }
    function validateLeaveRequest(dates, start, end, reason) {
        if (!dates.length) return 'Vui lòng chọn ít nhất một ngày nghỉ.';
        const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
        const seen=new Set();
        for(const slot of getLeaveSlots(dates,start,end)) {
            try { getLeaveDateRange(slot.date,slot.date); } catch { return 'Vui lòng chọn ngày hợp lệ cho từng dòng.'; }
            if(seen.has(slot.date)) return 'Mỗi ngày chỉ chọn một khoảng giờ nghỉ.';
            seen.add(slot.date);
            if (!timePattern.test(slot.start) || !timePattern.test(slot.end)) return 'Vui lòng nhập đủ giờ bắt đầu và kết thúc.';
            if (slot.start >= slot.end) return 'Giờ kết thúc phải sau giờ bắt đầu.';
        }
        if (!reason.trim()) return 'Vui lòng chọn hoặc nhập lý do nghỉ.';
        return '';
    }
    function formatLeaveRequest(type, dates, start, end, reason, leaders = []) {
        const times = [...new Set(getLeaveSlots(dates,start,end).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start))
            .map(slot => '- Time: ' + slot.start + ' - ' + slot.end + '  ' + formatLeaveDate(slot.date)))];
        const seen = new Set();
        const tags = leaders.filter(leader => leader && /^\d+$/.test(String(leader.id)) && !seen.has(String(leader.id)) && seen.add(String(leader.id)))
            .map(leader => '[To:' + leader.id + '] ' + String(leader.name || '').replace(/[\r\n]+/g, ' ').replace(/\[/g, '［').replace(/\]/g, '］').trim());
        return (tags.length ? tags.join('\n') + '\n' : '') + '[info]\n' + ['- Request: ' + type, ...times, '- Reason: ' + reason].join('\n') + '\n[/info]\n';
    }

    function getLeaveLeaderStorageKey() {
        const uid = window.CW?.application?.myId?.userId?.value || window.AC?.myid;
        const rid = window.location.hash.match(/rid(\d+)/)?.[1] || window.RM?.id || window.CW?.roomId;
        return uid && rid ? 'thk-leave-leaders.' + uid + '.' + rid : null;
    }
    function readLeaveLeaders(key) {
        if (!key) return [];
        try {
            const saved = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(saved) ? [...new Set(saved.map(String).filter(id => /^\d+$/.test(id)))] : [];
        } catch(error) { return []; }
    }
    function rememberLeaveLeaders(key, ids) {
        if (!key) return;
        try { localStorage.setItem(key, JSON.stringify([...new Set(ids.map(String).filter(id => /^\d+$/.test(id)))])); } catch(error) {}
    }

    function openLeaveRequestModal() {
        window.__thkToolkit?.close();
        closeMarkdownPreviewModal();
        if (document.getElementById('thk-modal-backdrop')) return;

        const types = [
            { key: 'PAID_LEAVE', name: 'Nghỉ phép năm', desc: 'Có hưởng lương' },
            { key: 'HALF-DAY_PAID_LEAVE', name: 'Nghỉ nửa ngày', desc: 'Có hưởng lương (Sáng/Chiều)' },
            { key: 'LATE', name: 'Đi muộn', desc: 'Báo đến muộn' },
            { key: 'LEAVE_EARLY', name: 'Về sớm', desc: 'Báo về sớm hơn giờ tan' },
            { key: 'ABSENT_DURING_WORK', name: 'Nghỉ giữa giờ', desc: 'Ra ngoài có việc riêng' },
            { key: 'UNPAID_LEAVE', name: 'Nghỉ không lương', desc: 'Cả ngày' },
            { key: 'HALF-DAY_UNPAID_LEAVE', name: 'Nghỉ nửa ngày KL', desc: 'Không hưởng lương' },
            { key: 'CHANGE_SCHEDULE', name: 'Đổi ca / Lịch', desc: 'Thay đổi giờ làm' },
            { key: 'CANCEL', name: 'Hủy đơn đã gửi', desc: 'Hủy request trước' }
        ];

        const times = [
            ['08:00', '17:00'], ['08:00', '12:00'],
            ['13:00', '17:00'], ['15:00', '17:00']
        ];
        const reasons = [
            { en: 'Personal matter', ja: '私用のため' },
            { en: 'Medical appointment / Illness', ja: '通院・体調不良のため' },
            { en: 'Administrative procedures', ja: '行政手続きのため' },
            { en: 'Family matter', ja: '家庭の事情のため' },
            { en: 'Caring for a sick family member', ja: '家族の看病のため' },
            { en: 'Traffic congestion / Severe weather', ja: '交通渋滞・悪天候のため' }
        ];
        let selectedType = 'PAID_LEAVE';
        let selectedReason = null;
        const now = new Date();
        const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')].join('-');
        const selectedSlots = [{date:today,start:'08:00',end:'17:00'}];
        const requestRoom = window.location.hash.match(/rid(\d+)/)?.[1] || '';
        const leaderStorageKey = getLeaveLeaderStorageKey();
        const selectedLeaderIds = new Set(readLeaveLeaders(leaderStorageKey));
        let leaderMembers = [];

        const modalEl = document.createElement('div');
        modalEl.id = 'thk-modal-backdrop';
        modalEl.className = 'thk-modal-backdrop';

        modalEl.innerHTML = `
            <div class="thk-modal-box">
                <div class="thk-modal-header">
                    <div class="thk-modal-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>
                        <span>Tạo Đơn Nghỉ / Báo Bận Nhanh</span>
                    </div>
                    <button type="button" class="thk-modal-close" id="thkModalClose" title="Đóng (Esc)">✕</button>
                </div>
                <div class="thk-modal-body">
                    <div class="thk-sec-title">1. Chọn loại yêu cầu (Request)</div>
                    <div class="thk-type-grid" id="thkTypeGrid">
                        ${types.map((t, idx) => `
                            <div class="thk-type-card ${idx === 0 ? 'active' : ''}" data-type="${t.key}">
                                <span class="thk-type-name">${t.name}</span>
                                <span class="thk-type-desc">${t.key}</span>
                            </div>
                        `).join('')}
                    </div>

                    <div class="thk-sec-title">2. Ngày và thời gian nghỉ</div>
                    <p class="thk-leave-hint">Mỗi dòng là một ngày kèm khoảng giờ nghỉ riêng.</p>
                    <div id="thkSelectedDates" class="thk-leave-slots"></div>
                    <div class="thk-chips-row"><button type="button" class="thk-chip-btn" id="thkAddSingleDate">Thêm ngày</button><button type="button" class="thk-chip-btn" id="thkClearDates">Bỏ chọn tất cả</button></div>
                    <details class="thk-leave-range"><summary>Thêm nhiều ngày cùng khoảng giờ</summary>
                      <div class="thk-leave-fields">
                        <label>Từ ngày<input type="date" id="thkDateStart" class="thk-input-field" value="${today}" /></label>
                        <label>Đến ngày<input type="date" id="thkDateEnd" class="thk-input-field" value="${today}" /></label>
                        <label>Từ giờ<input type="time" id="thkTimeStart" class="thk-input-field" value="08:00" /></label>
                        <label>Đến giờ<input type="time" id="thkTimeEnd" class="thk-input-field" value="17:00" /></label>
                      </div>
                      <button type="button" class="thk-chip-btn" id="thkAddDates">Thêm khoảng ngày</button>
                    </details>
                    <div class="thk-sec-title">3. Tag leader (có thể chọn nhiều người)</div>
                    <div class="thk-leader-search-row">
                        <input type="search" id="thkLeaderSearch" class="thk-input-field" placeholder="Tìm tên hoặc ID leader..." aria-label="Tìm leader" />
                        <button type="button" id="thkReloadLeaders" class="thk-chip-btn">Tải lại</button>
                    </div>
                    <div id="thkSelectedLeaders" class="thk-chips-row" aria-label="Leader đã chọn"></div>
                    <div id="thkLeaderResults" class="thk-leader-results" role="group" aria-label="Danh sách leader"></div>
                    <p class="thk-leave-hint">Mỗi leader được tag trên một dòng. Danh sách được nhớ sau khi sao chép, chèn hoặc gửi request.</p>
                    <div class="thk-sec-title">4. Lý do (Reason / 理由)</div>
                    <label for="thkReasonLanguage">Ngôn ngữ lý do gợi ý</label>
                    <select id="thkReasonLanguage" class="thk-input-field"><option value="en">English</option><option value="ja">日本語</option><option value="both">English / 日本語</option></select>
                    <div class="thk-chips-row" id="thkReasonChips">
                        ${reasons.map((r, idx) => `<button type="button" class="thk-chip-btn" data-reason-index="${idx}">${r.en} / ${r.ja}</button>`).join("")}
                    </div>
                    <input type="text" id="thkReasonInput" class="thk-input-field" placeholder="Personal matter / 私用のため" required />
                    <p id="thkLeaveError" class="thk-leave-error" role="alert"></p>
                    <div class="thk-sec-title">Xem trước tin nhắn</div>
                    <div class="thk-preview-card thk-chat-preview" id="thkLeaveRendered" aria-live="polite"></div>
                    <details class="thk-source-details"><summary>Mã tin nhắn</summary><pre class="thk-preview-raw" id="thkPrevRaw"></pre></details>
                </div>
                <div class="thk-modal-footer">
                    <button type="button" class="thk-btn-secondary" id="thkBtnModalCopy" title="Sao chép nội dung">Sao chép</button>
                    <div style="flex: 1;"></div>
                    <button type="button" class="thk-btn-secondary" id="thkBtnModalCancel">Hủy (Esc)</button>
                    <button type="button" class="thk-btn-primary" id="thkBtnModalInsert">Chèn vào chat <span class="thk-kbd">↵</span></button>
                    <button type="button" class="thk-btn-success" id="thkBtnModalSend">Gửi ngay <span class="thk-kbd">Ctrl+↵</span></button>
                </div>
            </div>
        `;

        document.body.appendChild(modalEl);

        const startTimeEl = document.getElementById('thkTimeStart');
        const endTimeEl = document.getElementById('thkTimeEnd');
        const startDateEl = document.getElementById('thkDateStart');
        const endDateEl = document.getElementById('thkDateEnd');
        const reasonEl = document.getElementById('thkReasonInput');
        const languageEl = document.getElementById('thkReasonLanguage');
        const prevRaw = document.getElementById('thkPrevRaw');
        const errorEl = document.getElementById('thkLeaveError');
        const leaderSearch = document.getElementById('thkLeaderSearch');
        const leaderResults = document.getElementById('thkLeaderResults');
        const selectedLeadersEl = document.getElementById('thkSelectedLeaders');

        // Type selection
        document.querySelectorAll('#thkTypeGrid .thk-type-card').forEach(function(card) {
            card.addEventListener('click', function() {
                document.querySelectorAll('#thkTypeGrid .thk-type-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                selectedType = card.getAttribute('data-type');
                updatePreview();
            });
        });

        function getFormattedOutput() {
            return formatLeaveRequest(selectedType, selectedSlots, '', '', reasonEl.value.trim(), selectedLeaders());
        }
        function selectedLeaders() {
            const byId = new Map(leaderMembers.map(member => [String(member.id), member]));
            return [...selectedLeaderIds].map(id => byId.get(id)).filter(Boolean);
        }
        function rememberLeaderSelection() {
            rememberLeaveLeaders(leaderStorageKey, selectedLeaders().map(member => member.id));
        }
        function renderSelectedLeaders() {
            selectedLeadersEl.replaceChildren();
            const known = new Map(leaderMembers.map(member => [String(member.id), member]));
            [...selectedLeaderIds].map(id => known.get(id) || { id, name: 'ID: ' + id }).forEach(member => {
                const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'thk-chip-btn active';
                chip.textContent = member.name + ' ×'; chip.setAttribute('aria-label', 'Bỏ leader ' + member.name);
                chip.addEventListener('click', () => { selectedLeaderIds.delete(String(member.id)); renderSelectedLeaders(); updatePreview(); });
                selectedLeadersEl.appendChild(chip);
            });
            leaderResults.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = selectedLeaderIds.has(input.value); });
        }
        function renderLeaderResults() {
            leaderResults.replaceChildren();
            const query = normalizeSearch(leaderSearch.value.replace(/^@/, ''));
            const matches = leaderMembers.filter(member => !query || normalizeSearch(member.name).includes(query) || String(member.id).includes(query));
            matches.slice(0, 60).forEach(member => {
                const label = document.createElement('label'); label.className = 'thk-leader-option';
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(member.id); checkbox.checked = selectedLeaderIds.has(checkbox.value);
                checkbox.addEventListener('change', () => { if (checkbox.checked) selectedLeaderIds.add(checkbox.value); else selectedLeaderIds.delete(checkbox.value); renderSelectedLeaders(); updatePreview(); });
                const name = document.createElement('span'); name.textContent = member.name;
                label.append(checkbox, name); leaderResults.appendChild(label);
            });
            if (!matches.length) {
                const empty = document.createElement('p'); empty.className = 'thk-leave-hint';
                empty.textContent = leaderMembers.length ? 'Không tìm thấy leader phù hợp.' : 'Chưa tải được danh sách thành viên. Bấm Tải lại để thử lại.';
                leaderResults.appendChild(empty);
            } else if (matches.length > 60) {
                const more = document.createElement('p'); more.className = 'thk-leave-hint'; more.textContent = 'Nhập tên để tìm trong ' + matches.length + ' thành viên.'; leaderResults.appendChild(more);
            }
        }
        function refreshLeaders() {
            if (!modalEl.isConnected) return;
            leaderMembers = getRoomMembers().filter(member => /^\d+$/.test(String(member.id)));
            renderLeaderResults(); renderSelectedLeaders(); updatePreview();
        }
        leaderSearch.addEventListener('input', renderLeaderResults);
        document.getElementById('thkReloadLeaders').addEventListener('click', refreshLeaders);
        document.addEventListener('thk-members-ready', refreshLeaders);
        function updatePreview() {
            prevRaw.textContent = getFormattedOutput();
            document.getElementById('thkLeaveRendered').innerHTML = parseMarkdownAndBBCode(getFormattedOutput());
            errorEl.textContent = '';
            modalEl.querySelectorAll('.thk-leave-slot').forEach((row,index)=>{
                row.querySelectorAll('.thk-slot-presets button').forEach(chip=>chip.classList.toggle('active',chip.dataset.start===selectedSlots[index].start&&chip.dataset.end===selectedSlots[index].end));
            });
        }
        function renderDates() {
            const container = document.getElementById('thkSelectedDates'); container.replaceChildren();
            selectedSlots.forEach((slot,index)=>{
                const row=document.createElement('div');row.className='thk-leave-slot';
                const fields=document.createElement('div');fields.className='thk-slot-fields';
                function input(labelText,type,key){
                    const label=document.createElement('label');label.textContent=labelText;
                    const input=document.createElement('input');input.type=type;input.className='thk-input-field thk-slot-'+key;input.value=slot[key];input.required=true;
                    input.addEventListener('input',()=>{slot[key]=input.value;updatePreview();});label.appendChild(input);fields.appendChild(label);return input;
                }
                input('Ngày nghỉ','date','date');const from=input('Từ giờ','time','start'),to=input('Đến giờ','time','end');
                const remove=document.createElement('button');remove.type='button';remove.className='thk-btn-secondary thk-slot-remove';remove.textContent='×';remove.setAttribute('aria-label','Xóa dòng ngày nghỉ');
                remove.addEventListener('click',()=>{selectedSlots.splice(index,1);renderDates();});fields.appendChild(remove);row.appendChild(fields);
                const presets=document.createElement('div');presets.className='thk-slot-presets thk-chips-row';
                times.forEach(([start,end])=>{
                    const chip=document.createElement('button');chip.type='button';chip.className='thk-chip-btn';chip.textContent=start+' - '+end;chip.dataset.start=start;chip.dataset.end=end;
                    chip.addEventListener('click',()=>{slot.start=start;slot.end=end;from.value=start;to.value=end;updatePreview();});presets.appendChild(chip);
                });row.appendChild(presets);container.appendChild(row);
            });updatePreview();
        }
        document.getElementById('thkAddSingleDate').addEventListener('click',()=>{
            const previous=selectedSlots[selectedSlots.length-1];let date=today;
            if(previous?.date){const next=new Date(previous.date+'T00:00:00Z');if(Number.isFinite(next.getTime())){next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);}}
            selectedSlots.push({date,start:previous?.start||'08:00',end:previous?.end||'17:00'});renderDates();
            modalEl.querySelector('.thk-leave-slot:last-child input')?.focus({preventScroll:true});
        });
        document.getElementById('thkAddDates').addEventListener('click',()=>{
            try{
                const dates=getLeaveDateRange(startDateEl.value,endDateEl.value||startDateEl.value);
                const error=validateLeaveRequest(dates,startTimeEl.value,endTimeEl.value,'range');if(error)throw new Error(error);
                dates.forEach(date=>{const existing=selectedSlots.find(slot=>slot.date===date);if(existing){existing.start=startTimeEl.value;existing.end=endTimeEl.value;}else selectedSlots.push({date,start:startTimeEl.value,end:endTimeEl.value});});renderDates();
            }catch(error){errorEl.textContent=error.message;}
        });
        document.getElementById('thkClearDates').addEventListener('click',()=>{selectedSlots.length=0;renderDates();});
        renderDates();refreshLeaders();
        reasonEl.addEventListener('input', () => {
            selectedReason = null;
            document.querySelectorAll('#thkReasonChips .thk-chip-btn').forEach(chip => chip.classList.remove('active'));
            updatePreview();
        });
        function applyReason() {
            if (selectedReason === null) return;
            const reason = reasons[selectedReason];
            reasonEl.value = languageEl.value === 'both' ? reason.en + ' / ' + reason.ja : reason[languageEl.value];
            updatePreview();
        }
        languageEl.addEventListener('change', applyReason);
        document.querySelectorAll('#thkReasonChips .thk-chip-btn').forEach(chip => {
            chip.addEventListener('click', () => {
                selectedReason = Number(chip.dataset.reasonIndex);
                document.querySelectorAll('#thkReasonChips .thk-chip-btn').forEach(c => c.classList.toggle('active', c === chip));
                applyReason();
            });
        });
        function validateRequest() {
            if ((window.location.hash.match(/rid(\d+)/)?.[1] || '') !== requestRoom) { errorEl.textContent = 'Phòng chat đã thay đổi. Vui lòng mở lại form request.'; return false; }
            if (selectedLeaders().length !== selectedLeaderIds.size) { errorEl.textContent = 'Chưa tải được thông tin một số leader đã lưu. Bấm Tải lại hoặc bỏ chọn leader đó.'; return false; }
            const error = validateLeaveRequest(selectedSlots, '', '', reasonEl.value);
            errorEl.textContent = error;
            return !error;
        }

        function closeModal() {
            window.removeEventListener('keydown', onModalKeyDown);
            document.removeEventListener('thk-members-ready', refreshLeaders);
            modalEl.remove();
            const chat = getChatText();
            if (chat) chat.focus();
        }

        document.getElementById('thkModalClose').addEventListener('click', closeModal);
        document.getElementById('thkBtnModalCancel').addEventListener('click', closeModal);
        modalEl.addEventListener('click', function(e) {
            if (e.target === modalEl) closeModal();
        });

        document.getElementById('thkBtnModalCopy').addEventListener('click', function() {
            if (!validateRequest()) return;
            const text = getFormattedOutput();
            copyTextToClipboard(text).then(function() {
                rememberLeaderSelection();
                const btn = document.getElementById('thkBtnModalCopy');
                btn.textContent = '✓ Đã chép!';
                setTimeout(function() { btn.textContent = 'Sao chép'; }, 1500);
            });
        });

        function doInsert() {
            if (!validateRequest()) return;
            const text = getFormattedOutput();
            closeModal();
            const chat = getChatText();
            if (chat) {
                const start = chat.selectionStart;
                const end = chat.selectionEnd;
                insertTextAtRange(start, end, text, text.length);
                rememberLeaderSelection();
            }
        }

        function doSend() {
            if (!validateRequest()) return;
            const text = getFormattedOutput();
            closeModal();
            const chat = getChatText();
            if (chat) {
                const start = chat.selectionStart;
                const end = chat.selectionEnd;
                insertTextAtRange(start, end, text, text.length);
                rememberLeaderSelection();
                setTimeout(function() {
                    const sendBtn = document.querySelector('#_sendButton') || [...document.querySelectorAll('#CurrentSelectedRoom button')].find(button => /^(Gửi|Send|送信)$/.test((button.getAttribute('aria-label') || button.textContent).trim()));
                    if (sendBtn) sendBtn.click();
                }, 60);
            }
        }

        document.getElementById('thkBtnModalInsert').addEventListener('click', doInsert);
        document.getElementById('thkBtnModalSend').addEventListener('click', doSend);

        function onModalKeyDown(e) {
            if (e.key === 'Escape') {
                closeModal();
                return;
            }
            if (e.isComposing) return;
            if (e.key === 'Enter') {
                if (!e.ctrlKey && !e.metaKey && e.target !== reasonEl) return;
                const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                const mod = isMac ? e.metaKey : e.ctrlKey;
                e.preventDefault();
                if (mod) {
                    doSend();
                } else {
                    doInsert();
                }
            }
        }
        window.addEventListener('keydown', onModalKeyDown);
        modalEl.querySelector('.thk-modal-box').setAttribute('role', 'dialog');
        modalEl.querySelector('.thk-modal-box').setAttribute('aria-modal', 'true');
        modalEl.querySelector('.thk-modal-box').setAttribute('aria-label', 'Tạo đơn nghỉ');

        setTimeout(() => reasonEl.focus({ preventScroll: true }), 120);
    }

    // ── 15. Markdown & Chatwork BBCode Parser and Preview Modal ───────────────
    // Render Chatwork tags only: Markdown markers remain literal, as in sent messages.
    function parseMarkdownAndBBCode(raw) {
        if (!raw || !raw.trim()) return '<div class="thk-md-empty">Chưa có nội dung tin nhắn để xem trước.</div>';
        const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const plain = value => {
            let html = '', cursor = 0;
            for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/g)) {
                html += escape(value.slice(cursor, match.index));
                const url = match[0];
                html += '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">' + escape(url) + '</a>';
                cursor = match.index + url.length;
            }
            return '<span class="thk-chat-text">' + html + escape(value.slice(cursor)) + '</span>';
        };
        const text = raw.replace(/\r\n?/g, '\n');
        function render(start, closing) {
            let html = '', cursor = start;
            const tokens = /\[(\/?)(info|title|code|qt)\]|\[hr\]|\[toall\]|\[To:(all|\d+)\]/gi;
            if (closing && text[cursor] === '\n') cursor++;
            tokens.lastIndex = cursor;
            let match;
            while ((match = tokens.exec(text))) {
                const tag = match[2]?.toLowerCase();
                const segment = text.slice(cursor, match.index);
                html += plain(match[1] && tag === closing ? segment.replace(/\n$/, '') : segment);
                if (match[1]) {
                    if (tag === closing) return { html, end: tokens.lastIndex, closed: true };
                    html += plain(match[0]); cursor = tokens.lastIndex; continue;
                }
                if (tag === 'code') {
                    const end = text.toLowerCase().indexOf('[/code]', tokens.lastIndex);
                    if (end === -1) { html += plain(text.slice(match.index)); return { html, end:text.length }; }
                    // Tag boundary newlines are layout, while indentation and inner whitespace stay intact.
                    const code = text.slice(tokens.lastIndex, end).replace(/^\n/, '').replace(/\n$/, '');
                    html += '<pre class="thk-md-code-block"><code>' + escape(code) + '</code></pre>';
                    cursor = end + 7;
                } else if (tag) {
                    const nested = render(tokens.lastIndex, tag);
                    if (!nested.closed) { html += plain(text.slice(match.index)); return { html, end:text.length }; }
                    const className = {info:'thk-md-info',title:'thk-md-info-title',qt:'thk-md-quote'}[tag];
                    html += '<div class="' + className + '">' + nested.html + '</div>';
                    cursor = nested.end;
                } else if (match[3] || match[0].toLowerCase() === '[toall]') {
                    html += '<span class="thk-md-mention">' + (match[3] === 'all' || match[0].toLowerCase() === '[toall]' ? 'TO ALL' : 'TO') + '</span>';
                    cursor = tokens.lastIndex;
                } else {
                    html += '<hr class="thk-md-hr">'; cursor = tokens.lastIndex;
                }
                // Ignore one formatting newline immediately after a block tag.
                if (!match[3] && match[0].toLowerCase() !== '[toall]' && text[cursor] === '\n') cursor++;
                tokens.lastIndex = cursor;
            }
            html += plain(text.slice(cursor));
            return { html, end:text.length, closed:false };
        }
        return render(0).html;
    }
    window.__thk_renderChatPreview = parseMarkdownAndBBCode;

    let closePreview = null;
    function closeMarkdownPreviewModal() {
        if (closePreview) { closePreview(); return; }
        const modal = document.getElementById('thk-preview-modal-backdrop');
        if (modal) modal.remove();
        const chat = getChatText();
        if (chat) chat.focus();
    }

    function openMarkdownPreviewModal() {
        window.__thkToolkit?.close();
        document.getElementById('thkModalClose')?.click();
        if (document.getElementById('thk-preview-modal-backdrop')) {
            closeMarkdownPreviewModal();
            return;
        }

        const chatText = getFormattingEditor();
        const canSend = chatText && chatText === getChatText();
        const rawContent = chatText ? chatText.value : '';

        const modalEl = document.createElement('div');
        modalEl.id = 'thk-preview-modal-backdrop';
        modalEl.className = 'thk-preview-modal-backdrop';

        const renderedHtml = parseMarkdownAndBBCode(rawContent);
        const charCount = rawContent.length;
        const lineCount = rawContent ? rawContent.split(/\r?\n/).length : 0;

        modalEl.innerHTML = `
            <div class="thk-preview-modal-box">
                <div class="thk-preview-header">
                    <div class="thk-preview-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                        <span>Xem trước tin nhắn</span>
                        <span class="thk-preview-badge">${charCount} ký tự • ${lineCount} dòng</span>
                    </div>
                    <button type="button" class="thk-preview-close" id="thkBtnClosePreview" title="Đóng (Esc)">✕</button>
                </div>
                <div class="thk-preview-body thk-chat-preview" id="thkPreviewContent">
                    ${renderedHtml}
                </div>
                <div class="thk-preview-footer">
                    <button type="button" class="thk-btn-secondary" id="thkBtnCopyPreview" title="Sao chép toàn bộ nội dung trong ô chat">Sao chép mã</button>
                    <div style="flex: 1;"></div>
                    <button type="button" class="thk-btn-secondary" id="thkBtnDismissPreview">Đóng (Esc)</button>
                    <button type="button" class="thk-btn-success" id="thkBtnSendFromPreview">Gửi tin nhắn <span class="thk-kbd">Ctrl+↵</span></button>
                </div>
            </div>
        `;

        document.body.appendChild(modalEl);
        document.getElementById('thkBtnSendFromPreview').hidden = !canSend;

        function closeModal() {
            closePreview = null;
            window.removeEventListener('keydown', onPreviewKeyDown, true);
            modalEl.remove();
            if (chatText) chatText.focus();
        }

        document.getElementById('thkBtnClosePreview').addEventListener('click', closeModal);
        document.getElementById('thkBtnDismissPreview').addEventListener('click', closeModal);
        modalEl.addEventListener('click', function(e) {
            if (e.target === modalEl) closeModal();
        });

        document.getElementById('thkBtnCopyPreview').addEventListener('click', function() {
            const textToCopy = extractCodeTagContent(rawContent) || rawContent;
            copyTextToClipboard(textToCopy).then(function() {
                const btn = document.getElementById('thkBtnCopyPreview');
                btn.textContent = '✓ Đã chép!';
                setTimeout(function() { btn.textContent = 'Sao chép mã'; }, 1500);
            });
        });

        function doSendFromPreview() {
            if (!canSend) return;
            closeModal();
            setTimeout(function() {
                const sendBtn = document.querySelector('#_sendButton') || [...document.querySelectorAll('#CurrentSelectedRoom button')].find(button => /^(Gửi|Send|送信)$/.test((button.getAttribute('aria-label') || button.textContent).trim()));
                if (sendBtn) sendBtn.click();
            }, 60);
        }

        document.getElementById('thkBtnSendFromPreview').addEventListener('click', doSendFromPreview);

        function onPreviewKeyDown(e) {
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopImmediatePropagation();
                closeModal();
                return;
            }
            if (e.key === 'Enter') {
                const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
                const mod = isMac ? e.metaKey : e.ctrlKey;
                if (mod) {
                    e.preventDefault(); e.stopImmediatePropagation();
                    doSendFromPreview();
                }
            }
        }
        closePreview = closeModal;
        window.addEventListener('keydown', onPreviewKeyDown, true);
        modalEl.querySelector('.thk-preview-modal-box').setAttribute('role', 'dialog');
        modalEl.querySelector('.thk-preview-modal-box').setAttribute('aria-modal', 'true');
        modalEl.querySelector('.thk-preview-modal-box').setAttribute('aria-label', 'Xem trước tin nhắn');
    }

    // ── 16. Quick Code Copy Button Injection ──────────────────────────────────
    function getCodeText(block) {
        const clone = block.cloneNode(true);
        if (typeof clone.querySelectorAll === 'function') {
            clone.querySelectorAll('.thk-code-copy-btn').forEach(button => button.remove());
        }

        // 1. If block contains code elements (<code class="_code">, [data-cwtag="code"], etc.)
        if (typeof block.querySelectorAll === 'function' && (!block.tagName || block.tagName.toLowerCase() !== 'code')) {
            const codeEls = Array.from(block.querySelectorAll('code, ._code, [data-cwtag="code"], [data-testid="code-block"], [data-testid="message-code"]'))
                .filter(el => el && el.nodeType === 1 && typeof el.matches === 'function' && !el.classList?.contains?.('thk-code-copy-btn'));
            if (codeEls.length > 0) {
                const parts = codeEls.map(el => {
                    const elClone = el.cloneNode(true);
                    if (typeof elClone.querySelectorAll === 'function') {
                        elClone.querySelectorAll('.thk-code-copy-btn').forEach(b => b.remove());
                    }
                    return (elClone.textContent || '').replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
                }).filter(Boolean);
                if (parts.length > 0) {
                    return parts.join('\n\n');
                }
            }
        }

        const raw = (clone.textContent || '').replace(/\r\n?/g, '\n');

        // 2. If raw text contains [code]...[/code] BBCode tags or markdown ```...```
        const extracted = extractCodeTagContent(raw);
        if (extracted !== null) {
            return extracted;
        }

        return raw;
    }

    function extractCodeTagContent(text) {
        if (!text || typeof text !== 'string') return null;
        // 1. BBCode [code]...[/code]
        const bbRegex = /\[code\]([\s\S]*?)\[\/code\]/gi;
        const bbMatches = [];
        let m;
        while ((m = bbRegex.exec(text)) !== null) {
            bbMatches.push(m[1].replace(/^\r?\n|\r?\n$/g, ''));
        }
        if (bbMatches.length > 0) return bbMatches.join('\n\n');

        // 2. Markdown ```...```
        const mdRegex = /```[\w-]*\r?\n?([\s\S]*?)```/gi;
        const mdMatches = [];
        while ((m = mdRegex.exec(text)) !== null) {
            mdMatches.push(m[1].replace(/^\r?\n|\r?\n$/g, ''));
        }
        if (mdMatches.length > 0) return mdMatches.join('\n\n');

        return null;
    }

    let isCodeCopyInterceptorBound = false;
    function setupCodeSelectionCopyInterceptor() {
        if (isCodeCopyInterceptorBound) return;
        isCodeCopyInterceptorBound = true;
        document.addEventListener('copy', function(e) {
            const active = document.activeElement;
            if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable)) {
                return;
            }
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            const selectedText = sel.toString();
            if (!selectedText) return;

            const extracted = extractCodeTagContent(selectedText);
            if (extracted !== null) {
                if (e.clipboardData) {
                    e.clipboardData.setData('text/plain', extracted);
                    e.preventDefault();
                }
            }
        });
    }

    function isNativeCodeBlock(block) {
        if (block.matches('pre._code, pre.code, div._code, [data-cwtag="code"], [data-testid="code-block"], [data-testid="message-code"], .thk-md-code-block')) return true;
        if (block.querySelector(':scope > code')) return true;
        // Chatwork also renders ordinary messages and Info bodies with <pre>.
        // Real code uses a monospace font; a containing message is not a code block.
        if (block.querySelector('pre')) return false;
        return /monospace|consolas|courier|menlo|monaco|sfmono|roboto mono|source code|fira code/i.test(getComputedStyle(block).fontFamily);
    }
    function attachCodeCopyButtons() {
        const icon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
        const checked = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="5 12 10 17 20 7"/></svg>';
        const blocks = document.querySelectorAll('#_timeLine pre, #CurrentSelectedRoom pre, pre._code, pre.code, pre[data-cwtag="code"], div._code, code._code, code[data-cwtag="code"]');
        blocks.forEach(block => {
            if (block.closest('#thk-modal-backdrop, #thk-toolkit-panel, #thk-preview-modal-backdrop')) return;
            if (!isNativeCodeBlock(block)) {
                block.querySelectorAll(':scope > .thk-code-copy-btn').forEach(button => button.remove());
                block.classList.remove('thk-code-container');
                return;
            }
            if (block.querySelector(':scope > .thk-code-copy-btn')) return;
            block.classList.add('thk-code-container');
            const button = document.createElement('button');
            button.className = 'thk-code-copy-btn'; button.type = 'button'; button.innerHTML = icon;
            button.title = 'Sao chép đoạn mã'; button.setAttribute('aria-label', 'Sao chép đoạn mã');
            button.addEventListener('click', async event => {
                event.preventDefault(); event.stopPropagation();
                try {
                    await copyTextToClipboard(getCodeText(block));
                    button.innerHTML = checked; button.title = 'Đã sao chép'; button.setAttribute('aria-label', 'Đã sao chép'); button.classList.add('copied');
                } catch(error) { button.title = 'Không sao chép được. Bấm để thử lại.'; }
                setTimeout(() => { button.innerHTML = icon; button.title = 'Sao chép đoạn mã'; button.setAttribute('aria-label', 'Sao chép đoạn mã'); button.classList.remove('copied'); }, 1800);
            });
            block.appendChild(button);
        });
    }

    // ── 17. Shared Translation Helpers ───────────────────────────────────────
    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function decodeHtmlEntities(str) {
        return String(str || '')
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
    }

    const translationProviders = [
        {
            id: 'google-gtx',
            name: 'Google GTX API',
            async translate(query, targetLang) {
                const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + encodeURIComponent(targetLang) + '&dt=t&q=' + encodeURIComponent(query);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText || 'Lỗi mạng'})`);
                const data = await res.json();
                if (!Array.isArray(data?.[0])) throw new Error('Dữ liệu dịch không hợp lệ');
                const translated = data[0].map(s => s[0] || '').join('');
                const detected = data[2] || 'auto';
                if (!translated) throw new Error('Kết quả dịch trống');
                return { translated, detected };
            }
        },
        {
            id: 'google-client5',
            name: 'Google Client5 API',
            async translate(query, targetLang) {
                const url = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' + encodeURIComponent(targetLang) + '&q=' + encodeURIComponent(query);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText || 'Lỗi mạng'})`);
                const data = await res.json();
                if (!Array.isArray(data)) throw new Error('Dữ liệu dịch không hợp lệ');
                let translated = '';
                let detected = 'auto';
                if (Array.isArray(data[0])) {
                    translated = data.map(item => (Array.isArray(item) ? item[0] : item) || '').join('');
                    detected = data[0][1] || 'auto';
                } else if (typeof data[0] === 'string') {
                    translated = data.join('');
                }
                if (!translated) throw new Error('Kết quả dịch trống');
                return { translated, detected };
            }
        },
        {
            id: 'google-web-api',
            name: 'Google Web API',
            async translate(query, targetLang) {
                const url = 'https://translate.googleapis.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' + encodeURIComponent(targetLang) + '&q=' + encodeURIComponent(query);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText || 'Lỗi mạng'})`);
                const data = await res.json();
                if (!Array.isArray(data)) throw new Error('Dữ liệu dịch không hợp lệ');
                let translated = '';
                let detected = 'auto';
                if (Array.isArray(data[0])) {
                    translated = data.map(item => (Array.isArray(item) ? item[0] : item) || '').join('');
                    detected = data[0][1] || 'auto';
                } else if (typeof data[0] === 'string') {
                    translated = data.join('');
                }
                if (!translated) throw new Error('Kết quả dịch trống');
                return { translated, detected };
            }
        },
        {
            id: 'mymemory',
            name: 'MyMemory API',
            async translate(query, targetLang) {
                const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(query) + '&langpair=autodetect|' + encodeURIComponent(targetLang);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status} (${res.statusText || 'Lỗi mạng'})`);
                const data = await res.json();
                if (data.responseStatus !== 200 && data.responseStatus !== '200') {
                    throw new Error(data.responseDetails || ('Lỗi phản hồi ' + data.responseStatus));
                }
                const translated = data.responseData?.translatedText;
                if (!translated) throw new Error('Kết quả dịch trống');
                const decoded = decodeHtmlEntities(translated);
                return { translated: decoded, detected: 'auto' };
            }
        }
    ];

    async function translateText(text, targetLang = 'vi') {
        const trimmed = String(text || '').trim();
        if (!trimmed) return null;
        const query = trimmed.length > 4000 ? trimmed.substring(0, 4000) : trimmed;

        const providerErrors = [];
        for (const provider of translationProviders) {
            try {
                const res = await provider.translate(query, targetLang);
                if (providerErrors.length > 0) {
                    console.info('[THK Translation] Succeeded via fallback provider:', provider.name, 'after errors:', providerErrors);
                }
                return {
                    original: trimmed,
                    translated: res.translated,
                    detected: res.detected,
                    provider: provider.name
                };
            } catch (err) {
                const errMsg = `${provider.name}: ${err.message || 'Lỗi không xác định'}`;
                providerErrors.push(errMsg);
            }
        }

        const finalError = new Error('Tất cả API dịch đều thất bại:\n• ' + providerErrors.join('\n• '));
        finalError.providerErrors = providerErrors;
        throw finalError;
    }

    // ── 18. Text Selection Translation to Vietnamese ──────────────────────────
    function initSelectionTranslator() {
        if (window.__thkSelectionTranslatorLoaded) return;
        window.__thkSelectionTranslatorLoaded = true;

        let activePopover = null;
        let activeBubble = null;
        let selectionTimeout = null;

        function removeBubble() {
            if (activeBubble) {
                activeBubble.remove();
                activeBubble = null;
            }
        }

        function closePopover() {
            if (activePopover) {
                activePopover.remove();
                activePopover = null;
            }
        }

        function insertIntoChat(translated) {
            const chatText = document.querySelector('#_chatText, #CurrentSelectedRoom textarea, #_chatSendArea textarea');
            if (!chatText) return;
            const snippet = `[info][title]Bản dịch (tiếng Việt)[/title]\n${translated}\n[/info]\n`;
            const start = chatText.selectionStart || chatText.value.length;
            const end = chatText.selectionEnd || chatText.value.length;
            const val = chatText.value;
            chatText.value = val.substring(0, start) + snippet + val.substring(end);
            chatText.focus();
            chatText.setSelectionRange(start + snippet.length, start + snippet.length);
            chatText.dispatchEvent(new Event('input', { bubbles: true }));
        }

        async function showTranslationPopover(text, rect) {
            closePopover();
            removeBubble();

            const popover = document.createElement('div');
            popover.id = 'thk-translate-popover';
            popover.className = 'thk-translate-popover';
            popover.innerHTML = `
                <div class="thk-translate-header">
                    <span class="thk-translate-title">🌐 Dịch sang tiếng Việt</span>
                    <button class="thk-translate-close" type="button" aria-label="Đóng">✕</button>
                </div>
                <div class="thk-translate-body">
                    <div class="thk-translate-loading">
                        <span class="thk-translate-spinner"></span> Đang dịch…
                    </div>
                </div>
            `;
            document.body.appendChild(popover);
            activePopover = popover;

            function updatePosition() {
                if (!popover || !popover.isConnected) return;
                const popWidth = Math.min(360, window.innerWidth - 24);
                popover.style.width = popWidth + 'px';
                const popHeight = popover.offsetHeight || 120;

                let left = rect
                    ? (rect.left + (rect.width / 2) - (popWidth / 2))
                    : (window.innerWidth / 2 - popWidth / 2);
                left = Math.max(10, Math.min(window.innerWidth - popWidth - 10, left));

                let top;
                if (rect) {
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const spaceAbove = rect.top;

                    // If space below is not enough for popover, place it above the text selection
                    if (spaceBelow < popHeight + 14 && spaceAbove >= popHeight + 14) {
                        top = rect.top - popHeight - 8;
                    } else if (spaceBelow >= popHeight + 14) {
                        top = rect.bottom + 8;
                    } else {
                        // Tight space on both sides: pick side with more space
                        if (spaceAbove > spaceBelow) {
                            top = Math.max(10, rect.top - popHeight - 8);
                        } else {
                            top = Math.min(window.innerHeight - popHeight - 10, rect.bottom + 8);
                        }
                    }
                } else {
                    top = Math.max(10, (window.innerHeight - popHeight) / 2);
                }

                // Strict screen edge clamp: never overflow bottom or top
                if (top + popHeight > window.innerHeight - 10) {
                    top = Math.max(10, window.innerHeight - popHeight - 10);
                }
                if (top < 10) {
                    top = 10;
                }

                popover.style.top = top + 'px';
                popover.style.left = left + 'px';
            }

            updatePosition();

            popover.querySelector('.thk-translate-close')?.addEventListener('click', closePopover);

            try {
                const res = await translateText(text, 'vi');
                if (!popover.isConnected || popover !== activePopover) return;
                const langNames = { ja: 'Tiếng Nhật', en: 'Tiếng Anh', zh: 'Tiếng Trung', 'zh-CN': 'Tiếng Trung', ko: 'Tiếng Hàn', fr: 'Tiếng Pháp', de: 'Tiếng Đức', ru: 'Tiếng Nga' };
                const langLabel = langNames[res.detected] || res.detected || 'Tự động';

                const title = popover.querySelector('.thk-translate-title');
                if (title) {
                    title.innerHTML = `🌐 Bản dịch TV <span class="thk-translate-badge">${escapeHtml(langLabel)}</span>`;
                }

                const body = popover.querySelector('.thk-translate-body');
                if (body) {
                    body.innerHTML = `
                        <div class="thk-translate-text">${escapeHtml(res.translated)}</div>
                    `;
                }

                const footer = document.createElement('div');
                footer.className = 'thk-translate-footer';

                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'thk-chip-btn thk-translate-btn';
                copyBtn.textContent = '📋 Sao chép';
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard?.writeText(res.translated);
                    copyBtn.textContent = '✓ Đã chép!';
                    setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = '📋 Sao chép'; }, 1500);
                });
                footer.appendChild(copyBtn);

                const quoteBtn = document.createElement('button');
                quoteBtn.type = 'button';
                quoteBtn.className = 'thk-chip-btn thk-translate-btn';
                quoteBtn.textContent = '💬 Trích dẫn vào ô chat';
                quoteBtn.addEventListener('click', () => {
                    insertIntoChat(res.translated);
                    closePopover();
                });
                footer.appendChild(quoteBtn);

                popover.appendChild(footer);

                // Reposition accurately with final rendered height to prevent overflow
                updatePosition();
            } catch (err) {
                if (!popover.isConnected || popover !== activePopover) return;
                const body = popover.querySelector('.thk-translate-body');
                if (body) {
                    const errorList = (err.providerErrors && err.providerErrors.length > 0)
                        ? err.providerErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('')
                        : `<li>${escapeHtml(err.message || 'Lỗi không xác định')}</li>`;
                    body.innerHTML = `
                        <div class="thk-translate-error">
                            <div class="thk-translate-error-title">❌ Lỗi dịch thuật</div>
                            <div class="thk-translate-error-desc">Đã thử tất cả máy chủ dịch nhưng đều thất bại:</div>
                            <ul class="thk-translate-error-list">${errorList}</ul>
                            <button type="button" class="thk-translate-btn-retry">🔄 Thử lại</button>
                        </div>
                    `;
                    body.querySelector('.thk-translate-btn-retry')?.addEventListener('click', () => {
                        showTranslationPopover(text, rect);
                    });
                }
                updatePosition();
            }
        }

        function checkSelection() {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
                removeBubble();
                return;
            }
            const text = sel.toString().trim();
            if (text.length < 2) {
                removeBubble();
                return;
            }
            const anchor = sel.anchorNode;
            if (anchor && anchor.parentElement?.closest?.('#thk-translate-popover, .thk-translate-popover')) {
                return;
            }
            const range = sel.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                removeBubble();
                return;
            }

            // Check if Chatwork's native message selection tooltip exists in DOM
            const nativePopup = document.querySelector('#_selectionArea, #_messageSelectionPopup, ._messageSelectionTooltip, [class*="selectionPopup"], [class*="SelectionPopup"], [class*="selectionTooltip"], [class*="selectionMenu"]');
            if (nativePopup && nativePopup.isConnected) {
                if (!nativePopup.querySelector('.thk-translate-selection-btn')) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'thk-translate-selection-btn';
                    btn.innerHTML = '🌐 Dịch sang TV';
                    btn.title = 'Dịch sang tiếng Việt';
                    btn.setAttribute('aria-label', 'Dịch sang tiếng Việt');
                    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
                    btn.addEventListener('click', e => {
                        e.preventDefault(); e.stopPropagation();
                        showTranslationPopover(text, rect);
                    });
                    nativePopup.appendChild(btn);
                }
                removeBubble();
                return;
            }

            // Show floating bubble next to the selection
            let bubble = activeBubble;
            if (!bubble) {
                bubble = document.createElement('div');
                bubble.id = 'thk-selection-translate-bubble';
                bubble.className = 'thk-selection-translate-bubble';
                bubble.innerHTML = '<span class="thk-translate-bubble-icon">🌐</span><span>Dịch sang TV</span>';
                bubble.setAttribute('role', 'button');
                bubble.setAttribute('tabindex', '0');
                bubble.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
                bubble.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    const currentSel = window.getSelection();
                    const currentText = currentSel ? currentSel.toString().trim() : text;
                    const currentRect = currentSel && currentSel.rangeCount > 0 ? currentSel.getRangeAt(0).getBoundingClientRect() : rect;
                    removeBubble();
                    showTranslationPopover(currentText || text, currentRect);
                });
                document.body.appendChild(bubble);
                activeBubble = bubble;
            }

            const bubbleWidth = 114;
            const bubbleHeight = 30;
            let top = rect.top - bubbleHeight - 6;
            let left = rect.left + (rect.width / 2) - (bubbleWidth / 2);
            if (top < 10) {
                top = rect.bottom + 6;
            }
            if (top + bubbleHeight > window.innerHeight - 6) {
                top = window.innerHeight - bubbleHeight - 6;
            }
            left = Math.max(10, Math.min(window.innerWidth - bubbleWidth - 10, left));
            bubble.style.top = top + 'px';
            bubble.style.left = left + 'px';
            bubble.style.display = 'inline-flex';
        }

        document.addEventListener('mouseup', () => {
            clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(checkSelection, 80);
        });

        document.addEventListener('keyup', e => {
            if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                clearTimeout(selectionTimeout);
                selectionTimeout = setTimeout(checkSelection, 80);
            }
        });

        document.addEventListener('mousedown', e => {
            if (activePopover && !activePopover.contains(e.target)) {
                closePopover();
            }
            if (activeBubble && !activeBubble.contains(e.target) && !e.target.closest?.('.thk-translate-selection-btn')) {
                removeBubble();
            }
        });

        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                closePopover();
                removeBubble();
            }
        });
    }

    // ── 19. Full Page & Timeline Translation to Vietnamese ─────────────────────
    function initFullPageTranslator() {
        if (window.__thkFullPageTranslatorLoaded) return;
        window.__thkFullPageTranslatorLoaded = true;

        let isFullPageTranslateActive = false;
        let hideOriginals = false;
        const fullTranslateCache = new Map();
        let fullTranslateObserver = null;
        let fullTranslateDebounce = null;

        function updateButtons() {
            document.querySelectorAll('#thkBtnTranslatePage').forEach(btn => {
                btn.setAttribute('aria-pressed', isFullPageTranslateActive ? 'true' : 'false');
                if (isFullPageTranslateActive) {
                    btn.classList.add('active');
                    btn.title = 'Tắt dịch toàn bộ trang (Ctrl+Shift+T / Cmd+Shift+T)';
                } else {
                    btn.classList.remove('active');
                    btn.title = 'Dịch toàn bộ trang sang tiếng Việt (Ctrl+Shift+T / Cmd+Shift+T)';
                }
            });
        }

        function ensureFullTranslateBanner() {
            let banner = document.getElementById('thk-full-trans-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'thk-full-trans-banner';
                banner.className = 'thk-full-trans-banner';
                banner.innerHTML = `
                    <div class="thk-trans-banner-info">
                        <span class="thk-trans-banner-icon">🌐</span>
                        <span class="thk-trans-banner-text">Đang bật dịch toàn bộ trang sang Tiếng Việt</span>
                        <span class="thk-trans-banner-count" id="thk-trans-count">Đang quét tin nhắn…</span>
                    </div>
                    <div class="thk-trans-banner-actions">
                        <button type="button" class="thk-trans-banner-btn" id="thk-btn-toggle-orig">${hideOriginals ? 'Hiện bản gốc' : 'Ẩn bản gốc'}</button>
                        <button type="button" class="thk-trans-banner-btn thk-trans-banner-btn-close" id="thk-btn-stop-trans">✕ Tắt dịch</button>
                    </div>
                `;
                banner.querySelector('#thk-btn-toggle-orig')?.addEventListener('click', () => {
                    hideOriginals = !hideOriginals;
                    const timeline = document.querySelector('#_timeLine');
                    const toggleBtn = document.getElementById('thk-btn-toggle-orig');
                    if (hideOriginals) {
                        timeline?.classList.add('thk-hide-originals');
                        if (toggleBtn) toggleBtn.textContent = 'Hiện bản gốc';
                    } else {
                        timeline?.classList.remove('thk-hide-originals');
                        if (toggleBtn) toggleBtn.textContent = 'Ẩn bản gốc';
                    }
                });
                banner.querySelector('#thk-btn-stop-trans')?.addEventListener('click', () => {
                    toggleFullPageTranslation(false);
                });

                const timeline = document.querySelector('#_timeLine');
                if (timeline && timeline.parentElement) {
                    timeline.parentElement.insertBefore(banner, timeline);
                } else {
                    const room = document.getElementById('CurrentSelectedRoom') || document.body;
                    room.insertBefore(banner, room.firstChild);
                }
            }
        }

        function updateBannerCount() {
            const count = document.querySelectorAll('.thk-msg-translation:not(.thk-msg-trans-error)').length;
            const errorCount = document.querySelectorAll('.thk-msg-trans-error').length;
            const countEl = document.getElementById('thk-trans-count');
            if (countEl) {
                let msg = count > 0 ? `(Đã dịch ${count} tin nhắn)` : '(Đã quét xong)';
                if (errorCount > 0) {
                    msg += ` • ⚠️ Có ${errorCount} tin bị lỗi API`;
                }
                countEl.textContent = msg;
            }
        }

        async function translateAllVisibleMessages() {
            if (!isFullPageTranslateActive) return;

            const timeline = document.querySelector('#_timeLine, #CurrentSelectedRoom');
            if (!timeline) return;

            const msgNodes = timeline.querySelectorAll('div[id^="_message"], [data-mid], [data-message-id], ._message, .chatTimeLineMessage');
            const tasks = [];

            msgNodes.forEach(msgEl => {
                if (msgEl.querySelector('.thk-msg-translation:not(.thk-msg-trans-error)') || msgEl.getAttribute('data-thk-lang') === 'vi') return;
                const pre = msgEl.querySelector('pre:not(._code):not(.code):not([data-cwtag="code"])');
                const targetEl = pre || msgEl.querySelector('.chatTimeLineMessage__message, [data-cwui-comp="timeline-body"]');
                if (!targetEl) return;
                const text = (targetEl.innerText || '').trim();
                if (!text || text.length < 2) return;
                tasks.push({ msgEl, targetEl, text });
            });

            // Also check room description
            const descEl = document.querySelector('#_roomDescription, .roomDescription__content, [data-testid="room-description"]');
            if (descEl && !descEl.querySelector('.thk-msg-translation:not(.thk-msg-trans-error)') && descEl.getAttribute('data-thk-lang') !== 'vi') {
                const text = (descEl.innerText || '').trim();
                if (text && text.length > 2) {
                    tasks.push({ msgEl: descEl, targetEl: descEl, text });
                }
            }

            if (tasks.length === 0) {
                updateBannerCount();
                return;
            }

            const concurrency = 4;
            let index = 0;
            const workers = Array(Math.min(concurrency, tasks.length)).fill(0).map(async () => {
                while (index < tasks.length && isFullPageTranslateActive) {
                    const item = tasks[index++];
                    try {
                        let res = fullTranslateCache.get(item.text);
                        if (!res) {
                            res = await translateText(item.text, 'vi');
                            if (res) fullTranslateCache.set(item.text, res);
                        }
                        if (!res || !isFullPageTranslateActive) continue;

                        if (res.detected === 'vi') {
                            item.msgEl.setAttribute('data-thk-lang', 'vi');
                            continue;
                        }

                        item.msgEl.querySelector('.thk-msg-trans-error')?.remove();
                        if (item.msgEl.querySelector('.thk-msg-translation')) continue;

                        const langNames = { ja: 'Tiếng Nhật', en: 'Tiếng Anh', zh: 'Tiếng Trung', 'zh-CN': 'Tiếng Trung', ko: 'Tiếng Hàn', fr: 'Tiếng Pháp', de: 'Tiếng Đức', ru: 'Tiếng Nga' };
                        const langLabel = langNames[res.detected] || res.detected?.toUpperCase() || 'Bản dịch';

                        const transEl = document.createElement('div');
                        transEl.className = 'thk-msg-translation';
                        transEl.setAttribute('data-thk-trans', 'true');
                        transEl.innerHTML = `
                            <div class="thk-msg-trans-header">
                                <span class="thk-msg-trans-tag">🌐 Bản dịch TV (${escapeHtml(langLabel)})</span>
                                <button type="button" class="thk-msg-trans-btn-copy" title="Sao chép bản dịch">📋 Sao chép</button>
                            </div>
                            <div class="thk-msg-trans-body">${escapeHtml(res.translated)}</div>
                        `;
                        transEl.querySelector('.thk-msg-trans-btn-copy')?.addEventListener('click', (e) => {
                            e.stopPropagation();
                            navigator.clipboard?.writeText(res.translated);
                            const btn = e.currentTarget;
                            btn.textContent = '✓ Đã chép!';
                            setTimeout(() => { if (btn.isConnected) btn.textContent = '📋 Sao chép'; }, 1200);
                        });

                        item.targetEl.insertAdjacentElement('afterend', transEl);
                    } catch (e) {
                        console.warn('[THK Full Page Translation] Error on item:', e);
                        if (isFullPageTranslateActive && !item.msgEl.querySelector('.thk-msg-translation')) {
                            const errEl = document.createElement('div');
                            errEl.className = 'thk-msg-translation thk-msg-trans-error';
                            errEl.setAttribute('data-thk-trans', 'true');
                            errEl.innerHTML = `
                                <div class="thk-msg-trans-header">
                                    <span class="thk-msg-trans-tag thk-msg-trans-tag-error">⚠️ Lỗi dịch</span>
                                    <button type="button" class="thk-msg-trans-btn-retry" title="Thử lại bản dịch tin nhắn này">🔄 Thử lại</button>
                                </div>
                                <div class="thk-msg-trans-body thk-msg-trans-error-text">${escapeHtml(e.message || 'Lỗi kết nối máy chủ dịch')}</div>
                            `;
                            errEl.querySelector('.thk-msg-trans-btn-retry')?.addEventListener('click', async (evt) => {
                                evt.stopPropagation();
                                errEl.remove();
                                fullTranslateCache.delete(item.text);
                                await translateAllVisibleMessages();
                            });
                            item.targetEl.insertAdjacentElement('afterend', errEl);
                        }
                    }
                }
            });

            await Promise.all(workers);
            updateBannerCount();
        }

        async function toggleFullPageTranslation(forceState) {
            if (typeof forceState === 'boolean') {
                isFullPageTranslateActive = forceState;
            } else {
                isFullPageTranslateActive = !isFullPageTranslateActive;
            }

            updateButtons();

            if (!isFullPageTranslateActive) {
                if (fullTranslateObserver) {
                    fullTranslateObserver.disconnect();
                    fullTranslateObserver = null;
                }
                document.getElementById('thk-full-trans-banner')?.remove();
                document.querySelectorAll('.thk-msg-translation').forEach(el => el.remove());
                document.querySelector('#_timeLine')?.classList.remove('thk-hide-originals');
                hideOriginals = false;
                return;
            }

            ensureFullTranslateBanner();
            await translateAllVisibleMessages();

            if (!fullTranslateObserver) {
                const timeline = document.querySelector('#_timeLine, #CurrentSelectedRoom');
                if (timeline) {
                    fullTranslateObserver = new MutationObserver(() => {
                        clearTimeout(fullTranslateDebounce);
                        fullTranslateDebounce = setTimeout(() => {
                            if (isFullPageTranslateActive) translateAllVisibleMessages();
                        }, 350);
                    });
                    fullTranslateObserver.observe(timeline, { childList: true, subtree: true });
                }
            }
        }

        window.addEventListener('hashchange', () => {
            if (isFullPageTranslateActive) {
                setTimeout(() => {
                    if (isFullPageTranslateActive) {
                        ensureFullTranslateBanner();
                        translateAllVisibleMessages();
                    }
                }, 400);
            }
        });

        window.__thkToggleFullPageTranslation = toggleFullPageTranslation;
        window.__thkIsFullPageTranslateActive = () => isFullPageTranslateActive;
    }

    // ── 20. Periodic & Mutation Check to bind dynamic elements ───────────────
    function initDynamicWatchers() {
        const update = () => {
            injectThkStyles(); setupQuickToolbar(); setupDescriptionToolbar(); attachCodeCopyButtons();
        };
        let pending = null;
        const schedule = () => {
            if (pending !== null) return;
            pending = setTimeout(() => {
                pending = null;
                if (window.__thkRoomFolders?.isScrolling?.()) { schedule(); return; }
                update();
            }, 80);
        };
        update();
        const observer = new MutationObserver(schedule);
        observer.observe(document.body || document.documentElement, {childList:true, subtree:true});
        window.addEventListener?.('resize', schedule);
        setInterval(schedule, 1000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initDynamicWatchers();
            setupCodeSelectionCopyInterceptor();
            initSelectionTranslator();
            initFullPageTranslator();
        });
    } else {
        initDynamicWatchers();
        setupCodeSelectionCopyInterceptor();
        initSelectionTranslator();
        initFullPageTranslator();
    }

    console.log('[THK Native Client] Fully initialized with Same-row Toolbar, Mention Dropdown, Markdown Preview & Leave Request Modal!');
})();
