/* More or Less Party - transport layer.
 * Default: WebRTC data channels via PeerJS (public PeerJS broker only used for signaling).
 * Test-only: ?transport=local uses BroadcastChannel (same browser, several tabs) - no network at all. */
(function () {
  'use strict';
  const PREFIX = 'molparty-v1-';
  const params = new URLSearchParams(location.search);
  const TRANSPORT = params.get('transport') === 'local' ? 'local' : 'peer';

  function makeCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
  function peerOptions() { return { debug: 1, config: { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:3478?transport=tcp'], username: 'peerjs', credential: 'peerjsp' }
  ] } }; }

  /* ---------------- HOST ---------------- */
  // handlers: onOpen(code), onMessage(connId, msg), onClose(connId), onError(text)
  function createHost(preferredCode, h) {
    let code = preferredCode || makeCode();
    const conns = new Map(); let nextId = 1;
    const api = { get code() { return code; }, transport: TRANSPORT,
      send(connId, msg) { const c = conns.get(connId); if (c) try { c.send(msg); } catch (e) {} },
      broadcast(msg) { for (const id of conns.keys()) api.send(id, msg); },
      drop(connId) { const c = conns.get(connId); if (c) { try { c.close(); } catch (e) {} conns.delete(connId); } } };

    if (TRANSPORT === 'local') {
      let bc;
      const open = () => {
        bc = new BroadcastChannel(PREFIX + code);
        const local = new Map(); // client key -> connId
        bc.onmessage = (ev) => {
          const m = ev.data; if (!m || m.dir !== 'up') return;
          let id = local.get(m.from);
          if (m.type === 'open') {
            if (id) { conns.delete(id); h.onClose(id); }
            id = 'c' + (nextId++); local.set(m.from, id);
            conns.set(id, { send: (msg) => bc.postMessage({ dir: 'down', to: m.from, type: 'msg', msg }), close: () => bc.postMessage({ dir: 'down', to: m.from, type: 'close' }) });
            bc.postMessage({ dir: 'down', to: m.from, type: 'opened' });
          } else if (m.type === 'close') { if (id) { local.delete(m.from); conns.delete(id); h.onClose(id); } }
          else if (m.type === 'msg' && id) h.onMessage(id, m.msg);
        };
        setTimeout(() => h.onOpen(code), 50);
      };
      open();
      return api;
    }

    let peer, destroyed = false;
    const start = () => {
      peer = new Peer(PREFIX + code, peerOptions());
      peer.on('open', () => h.onOpen(code));
      peer.on('connection', (conn) => {
        const id = 'c' + (nextId++);
        conn.on('open', () => { conns.set(id, conn); });
        conn.on('data', (d) => { if (!conns.has(id)) conns.set(id, conn); h.onMessage(id, d); });
        const closed = () => { if (conns.has(id)) { conns.delete(id); h.onClose(id); } };
        conn.on('close', closed); conn.on('error', closed);
        // detect dead ICE connections (phone sleeping)
        conn.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed' || s === 'closed') closed(); });
      });
      peer.on('disconnected', () => { if (!destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 1000); });
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id') { peer.destroy(); code = makeCode(); start(); return; }
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed') h.onError('Connection to the signaling server lost - retrying…');
        else if (e.type !== 'peer-unavailable') h.onError(String(e.type || e));
      });
    };
    start();
    return api;
  }

  /* ---------------- CLIENT ---------------- */
  // handlers: onStatus('connecting'|'open'|'closed'|'nohost', text), onMessage(msg)
  function createClient(code, h) {
    code = (code || '').toUpperCase();
    let alive = true, sendFn = null, retryT = null, attempt = 0;
    const api = { send(m) { if (sendFn) sendFn(m); }, get open() { return !!sendFn; }, retryNow() { if (!sendFn) connect(); } };
    const schedule = () => { if (!alive) return; clearTimeout(retryT); retryT = setTimeout(connect, Math.min(4000, 800 + attempt * 600)); };

    if (TRANSPORT === 'local') {
      const key = 'k' + Math.random().toString(36).slice(2);
      const bc = new BroadcastChannel(PREFIX + code);
      let openT;
      const connect = () => {
        attempt++; h.onStatus('connecting');
        bc.postMessage({ dir: 'up', from: key, type: 'open' });
        clearTimeout(openT); openT = setTimeout(() => { if (!sendFn) { h.onStatus('nohost'); schedule(); } }, 1500);
      };
      bc.onmessage = (ev) => { const m = ev.data; if (!m || m.dir !== 'down' || m.to !== key) return;
        if (m.type === 'opened') { attempt = 0; sendFn = (msg) => bc.postMessage({ dir: 'up', from: key, type: 'msg', msg }); h.onStatus('open'); }
        else if (m.type === 'msg') h.onMessage(m.msg);
        else if (m.type === 'close') { sendFn = null; h.onStatus('closed'); schedule(); } };
      window.addEventListener('pagehide', () => bc.postMessage({ dir: 'up', from: key, type: 'close' }));
      connect();
      return api;
    }

    let peer = null, conn = null;
    const ensurePeer = (cb) => {
      if (peer && !peer.destroyed && peer.open) return cb();
      if (peer && !peer.destroyed && !peer.disconnected) { peer.once('open', cb); return; }
      try { if (peer) peer.destroy(); } catch (e) {}
      peer = new Peer(peerOptions());
      peer.on('open', cb);
      peer.on('error', (e) => { if (e.type === 'peer-unavailable') { h.onStatus('nohost'); } else h.onStatus('closed', String(e.type)); sendFn = null; schedule(); });
      peer.on('disconnected', () => { /* signaling lost - data channel may still work */ });
    };
    const connect = () => {
      if (!alive) return;
      attempt++; h.onStatus('connecting');
      ensurePeer(() => {
        try { if (conn) conn.close(); } catch (e) {}
        const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn = c;
        const to = setTimeout(() => { if (conn === c && !sendFn) { try { c.close(); } catch (e) {} h.onStatus('nohost'); schedule(); } }, 9000);
        c.on('open', () => { clearTimeout(to); if (conn !== c) return; attempt = 0; sendFn = (m) => { try { c.send(m); } catch (e) {} }; h.onStatus('open'); });
        c.on('data', (d) => { if (conn === c) h.onMessage(d); });
        const lost = () => { if (conn !== c) return; clearTimeout(to); sendFn = null; h.onStatus('closed'); schedule(); };
        c.on('close', lost); c.on('error', lost);
        c.on('iceStateChanged', (s) => { if (s === 'disconnected' || s === 'failed') lost(); });
      });
    };
    connect();
    return api;
  }

  window.MOLNet = { createHost, createClient, makeCode, TRANSPORT };
})();
