import React, { useEffect, useRef, useState } from 'react';
import { getSocket } from './services/client';
import {
  chatErrorText, formatChatTime, isOwnMessage, MAX_CHAT_LENGTH, pushChatMessage, validateChatInput,
} from './services/chat';
import { MessageSquare, Send, X } from 'lucide-react';

const socket = getSocket();

export default function RoomChat({ roomId, userId, notify }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [chatDisabled, setChatDisabled] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState(null);
  const [rateLeftSec, setRateLeftSec] = useState(0);
  const seenIdsRef = useRef(new Set());
  const messagesRef = useRef([]);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const justOpenedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = [];
    setMessages([]);
    seenIdsRef.current = new Set();
    setDraft('');
    setSending(false);
    setSendError('');
    setChatDisabled(false);
    setRateLimitUntil(null);
    setRateLeftSec(0);
    setOpen(false);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return undefined;
    const onMessage = (message) => {
      if (!message || message.roomId !== roomId) return;
      // Dedupe and append OUTSIDE the state updater: React StrictMode invokes
      // updaters twice in development, and mutating the seen-id set inside one
      // made the second (kept) pass look like a duplicate, dropping every
      // message. Reading the ref here runs exactly once per socket event.
      const seenIds = seenIdsRef.current;
      if (message.id !== null && message.id !== undefined && seenIds.has(message.id)) return;
      const next = pushChatMessage(messagesRef.current, message, seenIds).messages;
      messagesRef.current = next;
      setMessages(next);
    };
    socket.on('chat_message', onMessage);
    return () => { socket.off('chat_message', onMessage); };
  }, [roomId]);

  useEffect(() => {
    if (rateLimitUntil === null) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.ceil((rateLimitUntil - Date.now()) / 1000));
      setRateLeftSec(left);
      if (left === 0) setRateLimitUntil(null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [rateLimitUntil]);

  useEffect(() => {
    const onDisconnect = () => setSending(false);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('disconnect', onDisconnect); };
  }, []);

  useEffect(() => {
    justOpenedRef.current = open;
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || justOpenedRef.current) el.scrollTop = el.scrollHeight;
    justOpenedRef.current = false;
  }, [messages, open]);

  const send = () => {
    if (sending || rateLimitUntil !== null) return;
    if (!socket.connected) {
      setSendError('Reconnect before sending.');
      return;
    }
    const validated = validateChatInput(draft);
    if (!validated.ok) {
      setSendError(chatErrorText(validated.code));
      return;
    }
    setSending(true);
    setSendError('');
    socket.timeout(8000).emit('chat_message', { roomId, text: validated.text }, (timeoutError, ack) => {
      setSending(false);
      if (timeoutError) {
        setSendError('Your message did not send. Check the connection and try again.');
        return;
      }
      if (ack?.ok) {
        setDraft('');
        return;
      }
      if (ack?.code === 'CHAT_RATE_LIMITED') {
        setRateLimitUntil(Date.now() + Math.max(1000, Number(ack.retryAfterMs) || 0));
        return;
      }
      if (ack?.code === 'ROOM_NOT_FOUND' || ack?.code === 'NOT_ROOM_MEMBER') {
        setChatDisabled(true);
        setSendError('You are no longer in this room, so chat is off.');
        notify('Room chat is unavailable.', 'info');
        return;
      }
      setSendError(chatErrorText(ack?.code) || ack?.error || 'Message could not be sent.');
    });
  };

  const blocked = chatDisabled || !socket.connected;
  const cannotSend = sending || blocked || rateLimitUntil !== null || !draft.trim();

  if (!open) {
    return (
      <button type="button" className="chat-toggle" onClick={() => setOpen(true)} aria-expanded="false" aria-controls="room-chat-panel">
        <MessageSquare size={16} aria-hidden="true" />
        <span>Room chat</span>
        {messages.length > 0 && <span className="chat-count num">{messages.length}</span>}
      </button>
    );
  }

  return (
    <section className="panel chat-panel" id="room-chat-panel" aria-label="Room chat">
      <div className="chat-head">
        <span className="chat-title"><MessageSquare size={15} aria-hidden="true" /> Room chat</span>
        <span className="chat-room">{roomId}</span>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat"><X size={16} /></button>
      </div>

      <div className="chat-messages" ref={listRef} role="log" aria-label="Messages in this room">
        {messages.length === 0 ? (
          <p className="chat-empty">No messages. Chat is ephemeral and only players in this room can read it.</p>
        ) : messages.map((message, index) => {
          const own = isOwnMessage(message, userId);
          return (
            <div key={message.id ?? index} className={`chat-msg${own ? ' is-own' : ''}`}>
              <div className="chat-msg-meta">
                <span className="chat-sender">{own ? 'You' : (message.username || 'Player')}</span>
                <time className="chat-time">{formatChatTime(message.at)}</time>
              </div>
              <p className="chat-text">{message.text}</p>
            </div>
          );
        })}
      </div>

      {(rateLimitUntil !== null || sendError) && (
        <p className="chat-error" role="alert">
          {rateLimitUntil !== null ? `Slow down — try again in ${rateLeftSec}s.` : sendError}
        </p>
      )}

      <div className="chat-input-row">
        <input
          ref={inputRef}
          type="text"
          className="input chat-input"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={blocked ? 'Chat unavailable' : 'Message the room'}
          aria-label="Chat message"
          disabled={blocked}
          onChange={(event) => { setDraft(event.target.value); if (sendError) setSendError(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); send(); }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm chat-send" aria-label="Send message" disabled={cannotSend} onClick={send}>
          <Send size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
