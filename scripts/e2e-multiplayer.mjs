import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const chromium = process.env.CHROMIUM_BIN || 'chromium';
const artifactsDir = process.env.E2E_ARTIFACTS_DIR || path.resolve('dist');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForDebugger(port, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error('Chromium debugging endpoint did not start');
}

async function attachPage(cdp, browserContextId, url, viewport) {
  const { targetId } = await cdp.send('Target.createTarget', { browserContextId, url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  return { targetId, sessionId };
}

async function evaluate(cdp, page, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, page.sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result.value;
}

async function waitFor(cdp, page, expression, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, page, expression);
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function clickButton(cdp, page, text) {
  const clicked = await evaluate(cdp, page, `(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Button not found: ${text}`);
}

async function setInput(cdp, page, selector, value) {
  await evaluate(cdp, page, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

async function screenshot(cdp, page, filename) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, page.sessionId);
  const output = path.join(artifactsDir, filename);
  await writeFile(output, Buffer.from(data, 'base64'));
  return output;
}

const profileDir = await mkdtemp(path.join(os.tmpdir(), 'noughtline-e2e-'));
const port = await openPort();
const browser = spawn(chromium, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${port}`,
  '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
browser.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

let cdp;
try {
  const version = await waitForDebugger(port);
  cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.connect();

  const hostContext = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const guestContext = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const host = await attachPage(cdp, hostContext, baseUrl, { width: 1280, height: 900, mobile: false });

  await waitFor(cdp, host, `document.readyState === 'complete'`, 'host document load');
  const hostBootstrap = await evaluate(cdp, host, `({
    href: location.href,
    title: document.title,
    text: document.body.innerText,
    buttons: document.querySelectorAll('button').length,
  })`);
  if (hostBootstrap.buttons <= 3) throw new Error(`Host app did not render: ${JSON.stringify(hostBootstrap)}`);
  await clickButton(cdp, host, 'Challenge a player');
  await waitFor(cdp, host, `Array.from(document.querySelectorAll('button')).some((b) => b.innerText === 'Host Game')`, 'multiplayer menu');
  await clickButton(cdp, host, 'Host Game');
  await waitFor(cdp, host, `Array.from(document.querySelectorAll('button')).some((b) => b.innerText === 'Create Game')`, 'host configuration');
  await clickButton(cdp, host, 'Create Game');
  const roomId = await waitFor(cdp, host, `document.querySelector('.invite-code-panel strong')?.textContent`, 'room creation');
  const inviteUrl = await evaluate(cdp, host, `document.querySelector('.invite-url').textContent`);
  const inviteHasSecret = await evaluate(cdp, host, `document.querySelector('.invite-url').textContent.includes(localStorage.getItem('noughtline_access_token'))`);
  if (inviteHasSecret) throw new Error('Invite URL leaked the access token');
  await clickButton(cdp, host, 'Enter waiting room');
  await waitFor(cdp, host, `document.body.innerText.includes('Waiting for opponent')`, 'host waiting room');

  let guest = await attachPage(cdp, guestContext, inviteUrl, { width: 390, height: 844, mobile: true });
  const prefilled = await waitFor(cdp, guest, `document.querySelector('#room-code')?.value`, 'prefilled join dialog');
  if (prefilled !== roomId) throw new Error(`Invite prefill mismatch: ${prefilled} != ${roomId}`);
  await waitFor(cdp, guest, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Join room' && !button.disabled)`, 'guest socket readiness');

  await setInput(cdp, guest, '#room-code', 'x');
  await evaluate(cdp, guest, `document.querySelector('form').requestSubmit(); true`);
  const inlineError = await waitFor(cdp, guest, `document.querySelector('.form-error')?.textContent`, 'inline invalid-code error');
  if (!inlineError.includes('valid room code')) throw new Error(`Unexpected validation error: ${inlineError}`);

  await setInput(cdp, guest, '#room-code', roomId);
  await evaluate(cdp, guest, `document.querySelector('form').requestSubmit(); true`);
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && !document.querySelector('.modal-backdrop')`, 'guest joined game');
  await waitFor(cdp, host, `!document.body.innerText.includes('Waiting for opponent') && document.querySelectorAll('.square:not(:disabled)').length === 9`, 'host active board');

  const guestToken = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  await evaluate(cdp, host, `document.querySelectorAll('.square')[0].click(); true`);
  await waitFor(cdp, guest, `document.querySelectorAll('.square')[0].textContent.trim() === 'X'`, 'host move on guest board');
  await evaluate(cdp, guest, `document.querySelectorAll('.square')[3].click(); true`);
  await waitFor(cdp, host, `document.querySelectorAll('.square')[3].textContent.trim() === 'O'`, 'guest move on host board');

  await cdp.send('Page.reload', { ignoreCache: true }, guest.sessionId);
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && document.querySelectorAll('.square')[0].textContent.trim() === 'X' && document.querySelectorAll('.square')[3].textContent.trim() === 'O'`, 'guest refresh recovery');
  const guestTokenAfterRefresh = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  if (guestTokenAfterRefresh !== guestToken) throw new Error('Guest identity changed after refresh');

  await cdp.send('Target.closeTarget', { targetId: guest.targetId });
  const disconnectText = await waitFor(cdp, host, `document.querySelector('.disconnect-countdown')?.textContent`, 'host disconnect countdown');
  if (!disconnectText.includes('Opponent disconnected')) throw new Error(`Unexpected disconnect copy: ${disconnectText}`);
  const disabledWhilePaused = await evaluate(cdp, host, `document.querySelectorAll('.square:disabled').length`);
  if (disabledWhilePaused !== 9) throw new Error(`Expected 9 disabled cells while paused, got ${disabledWhilePaused}`);

  guest = await attachPage(cdp, guestContext, baseUrl, { width: 390, height: 844, mobile: true });
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && document.querySelectorAll('.square')[3].textContent.trim() === 'O'`, 'guest reconnect recovery');
  const guestTokenAfterReconnect = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  if (guestTokenAfterReconnect !== guestToken) throw new Error('Guest identity changed after reconnect');
  await waitFor(cdp, host, `!document.querySelector('.disconnect-countdown') && document.querySelectorAll('.square:not(:disabled)').length === 9`, 'host resumed board');

  const hostToken = await evaluate(cdp, host, `localStorage.getItem('noughtline_access_token')`);
  await cdp.send('Page.reload', { ignoreCache: true }, host.sessionId);
  await waitFor(cdp, host, `document.querySelector('.game-screen') && document.querySelectorAll('.square')[0].textContent.trim() === 'X' && document.querySelectorAll('.square')[3].textContent.trim() === 'O'`, 'host refresh recovery');
  const hostTokenAfterRefresh = await evaluate(cdp, host, `localStorage.getItem('noughtline_access_token')`);
  if (hostTokenAfterRefresh !== hostToken) throw new Error('Host identity changed after refresh');

  const hostScreenshot = await screenshot(cdp, host, '_e2e-host.png');
  const guestScreenshot = await screenshot(cdp, guest, '_e2e-guest-mobile.png');
  console.log(JSON.stringify({
    status: 'passed',
    baseUrl,
    roomId,
    inviteUrl,
    inlineError,
    disconnectText,
    board: ['X', null, null, 'O', null, null, null, null, null],
    hostScreenshot,
    guestScreenshot,
  }, null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  if (stderr) console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  cdp?.close();
  browser.kill('SIGTERM');
  await rm(profileDir, { recursive: true, force: true });
}
