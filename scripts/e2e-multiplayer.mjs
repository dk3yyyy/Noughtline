import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const baseUrl = (process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const chromium = process.env.CHROMIUM_BIN || 'chromium';
const artifactsDir = process.env.E2E_ARTIFACTS_DIR || path.resolve('test-results/e2e');

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

async function setViewport(cdp, page, viewport) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  }, page.sessionId);
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
  await mkdir(artifactsDir, { recursive: true });
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
  await clickButton(cdp, host, 'Host or join a room');
  await waitFor(cdp, host, `Array.from(document.querySelectorAll('button')).some((b) => b.innerText === 'Create room' && !b.disabled)`, 'host socket readiness');
  await clickButton(cdp, host, 'Create room');
  const roomId = await waitFor(cdp, host, `document.querySelector('.invite-code')?.textContent`, 'room creation');
  const inviteUrl = await evaluate(cdp, host, `document.querySelector('.invite-link').textContent`);
  const inviteHasSecret = await evaluate(cdp, host, `document.querySelector('.invite-link').textContent.includes(localStorage.getItem('noughtline_access_token'))`);
  if (inviteHasSecret) throw new Error('Invite URL leaked the access token');
  await clickButton(cdp, host, 'Enter waiting room');
  await waitFor(cdp, host, `document.body.innerText.includes('Waiting for your opponent')`, 'host waiting room');

  let guest = await attachPage(cdp, guestContext, inviteUrl, { width: 390, height: 844, mobile: true });
  const prefilled = await waitFor(cdp, guest, `document.querySelector('#join-code')?.value`, 'prefilled join dialog');
  if (prefilled !== roomId) throw new Error(`Invite prefill mismatch: ${prefilled} != ${roomId}`);
  await waitFor(cdp, guest, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Join' && !button.disabled)`, 'guest socket readiness');

  await setInput(cdp, guest, '#join-code', 'x');
  await evaluate(cdp, guest, `document.querySelector('form').requestSubmit(); true`);
  const inlineError = await waitFor(cdp, guest, `document.querySelector('.field-error')?.textContent`, 'inline invalid-code error');
  if (!inlineError.includes('valid room code')) throw new Error(`Unexpected validation error: ${inlineError}`);

  await setInput(cdp, guest, '#join-code', roomId);
  await evaluate(cdp, guest, `document.querySelector('form').requestSubmit(); true`);
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && !document.querySelector('.modal-backdrop')`, 'guest joined game', 25_000);
  await waitFor(cdp, host, `!document.body.innerText.includes('Waiting for your opponent') && document.querySelectorAll('.board-cell').length === 9`, 'host active board', 25_000);
  await waitFor(cdp, host, `!document.querySelectorAll('.board-cell')[0].disabled && document.querySelector('.game-status-text')?.textContent.includes('Your turn')`, 'host turn');

  const guestToken = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  await evaluate(cdp, host, `document.querySelectorAll('.board-cell')[0].click(); true`);
  await waitFor(cdp, guest, `Boolean(document.querySelectorAll('.board-cell')[0].querySelector('.mark-x'))`, 'host move on guest board', 25_000);
  await waitFor(cdp, guest, `!document.querySelectorAll('.board-cell')[3].disabled && document.querySelector('.game-status-text')?.textContent.includes('Your turn')`, 'guest turn');
  await evaluate(cdp, guest, `document.querySelectorAll('.board-cell')[3].click(); true`);
  await waitFor(cdp, host, `Boolean(document.querySelectorAll('.board-cell')[3].querySelector('.mark-o'))`, 'guest move on host board', 25_000);

  await cdp.send('Page.reload', { ignoreCache: true }, guest.sessionId);
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && Boolean(document.querySelectorAll('.board-cell')[0].querySelector('.mark-x')) && Boolean(document.querySelectorAll('.board-cell')[3].querySelector('.mark-o'))`, 'guest refresh recovery', 25_000);
  const guestTokenAfterRefresh = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  if (guestTokenAfterRefresh !== guestToken) throw new Error('Guest identity changed after refresh');

  await cdp.send('Target.closeTarget', { targetId: guest.targetId });
  const disconnectText = await waitFor(cdp, host, `document.querySelector('.game-status-text')?.textContent.includes('Opponent disconnected') && document.querySelector('.game-status-text')?.textContent`, 'host disconnect countdown');
  if (!disconnectText.includes('Opponent disconnected')) throw new Error(`Unexpected disconnect copy: ${disconnectText}`);
  const disabledWhilePaused = await evaluate(cdp, host, `document.querySelectorAll('.board-cell[aria-disabled="true"]').length`);
  if (disabledWhilePaused !== 9) throw new Error(`Expected 9 disabled cells while paused, got ${disabledWhilePaused}`);

  guest = await attachPage(cdp, guestContext, baseUrl, { width: 390, height: 844, mobile: true });
  await waitFor(cdp, guest, `document.querySelector('.game-screen') && Boolean(document.querySelectorAll('.board-cell')[3].querySelector('.mark-o'))`, 'guest reconnect recovery', 25_000);
  const guestTokenAfterReconnect = await evaluate(cdp, guest, `localStorage.getItem('noughtline_access_token')`);
  if (guestTokenAfterReconnect !== guestToken) throw new Error('Guest identity changed after reconnect');
  await waitFor(cdp, host, `!document.querySelector('.game-status')?.classList.contains('is-paused') && document.querySelectorAll('.board-cell:not([aria-disabled="true"])').length === 7`, 'host resumed board');

  const hostToken = await evaluate(cdp, host, `localStorage.getItem('noughtline_access_token')`);
  await cdp.send('Page.reload', { ignoreCache: true }, host.sessionId);
  await waitFor(cdp, host, `document.querySelector('.game-screen') && Boolean(document.querySelectorAll('.board-cell')[0].querySelector('.mark-x')) && Boolean(document.querySelectorAll('.board-cell')[3].querySelector('.mark-o'))`, 'host refresh recovery', 25_000);
  const hostTokenAfterRefresh = await evaluate(cdp, host, `localStorage.getItem('noughtline_access_token')`);
  if (hostTokenAfterRefresh !== hostToken) throw new Error('Host identity changed after refresh');

  const thirdContext = (await cdp.send('Target.createBrowserContext')).browserContextId;
  const third = await attachPage(cdp, thirdContext, baseUrl, { width: 1024, height: 800, mobile: false });
  await waitFor(cdp, third, `document.querySelectorAll('button').length > 3`, 'third player home');
  await clickButton(cdp, third, 'Host or join a room');
  await waitFor(cdp, third, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Create room' && !button.disabled)`, 'third player socket readiness');
  await clickButton(cdp, third, 'Create room');
  const conflictRoomId = await waitFor(cdp, third, `document.querySelector('.invite-code')?.textContent`, 'conflict room creation');
  const conflictInviteUrl = await evaluate(cdp, third, `document.querySelector('.invite-link').textContent`);
  await clickButton(cdp, third, 'Enter waiting room');
  await waitFor(cdp, third, `document.body.innerText.includes('Waiting for your opponent')`, 'third player waiting room');

  await cdp.send('Page.navigate', { url: conflictInviteUrl }, host.sessionId);
  await waitFor(cdp, host, `document.querySelector('#join-code')?.value === ${JSON.stringify(conflictRoomId)}`, 'host cross-room invite');
  await waitFor(cdp, host, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Join' && !button.disabled)`, 'host cross-room socket readiness');
  await evaluate(cdp, host, `document.querySelector('form').requestSubmit(); true`);
  await waitFor(cdp, host, `document.body.innerText.includes('You already have a match')`, 'active-room conflict dialog');
  const conflictExistingRoom = await evaluate(cdp, host, `document.querySelector('.invite-code')?.textContent`);
  if (conflictExistingRoom !== roomId) throw new Error(`Conflict pointed to ${conflictExistingRoom}, expected ${roomId}`);
  await clickButton(cdp, host, 'Resume match');
  await waitFor(cdp, host, `document.querySelector('.game-screen') && Boolean(document.querySelectorAll('.board-cell')[3].querySelector('.mark-o'))`, 'resume from active-room conflict');

  await clickButton(cdp, third, 'Leave match');
  await waitFor(cdp, third, `document.body.innerText.includes('Leave this waiting room?')`, 'waiting-room leave confirmation');
  const waitingSafeFocus = await evaluate(cdp, third, `document.activeElement?.innerText`);
  if (waitingSafeFocus !== 'Stay in room') throw new Error(`Waiting dialog focused ${waitingSafeFocus} instead of safe action`);
  await clickButton(cdp, third, 'Leave room');
  await waitFor(cdp, third, `Boolean(document.querySelector('.home-screen'))`, 'waiting host returned home');

  await clickButton(cdp, host, 'Leave match');
  await waitFor(cdp, host, `document.body.innerText.includes('Forfeit this series?')`, 'forfeit confirmation');
  const forfeitSafeFocus = await evaluate(cdp, host, `document.activeElement?.innerText`);
  if (forfeitSafeFocus !== 'Stay in match') throw new Error(`Forfeit dialog focused ${forfeitSafeFocus} instead of safe action`);
  await evaluate(cdp, host, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  await waitFor(cdp, host, `Boolean(!document.querySelector('.dialog-title') && document.querySelector('.game-screen'))`, 'forfeit cancellation');
  await clickButton(cdp, host, 'Leave match');
  await waitFor(cdp, host, `document.querySelector('.dialog-title')?.textContent === 'Forfeit this series?'`, 'reopened forfeit confirmation');
  const hostScreenshot = await screenshot(cdp, host, '_e2e-host-forfeit.png');
  await clickButton(cdp, host, 'Forfeit series');
  await waitFor(cdp, host, `Boolean(document.querySelector('.home-screen'))`, 'forfeiter returned home');
  const opponentResult = await waitFor(cdp, guest, `document.querySelector('.game-status-text')?.textContent`, 'opponent voluntary-forfeit result');
  if (!opponentResult.includes('Opponent forfeited')) throw new Error(`Unexpected opponent result: ${opponentResult}`);
  await waitFor(cdp, guest, `!document.querySelector('.toast')`, 'terminal state clears recovery toast');
  const terminalAction = await evaluate(cdp, guest, `Array.from(document.querySelectorAll('button')).find((button) => button.innerText === 'Return home')?.innerText`);
  if (terminalAction !== 'Return home') throw new Error(`Unexpected terminal action: ${terminalAction}`);
  const guestScreenshot = await screenshot(cdp, guest, '_e2e-guest-forfeit-mobile.png');

  const responsiveViewports = [
    { name: 'small-phone', width: 320, height: 653, mobile: true },
    { name: 'phone', width: 390, height: 844, mobile: true },
    { name: 'ipad-portrait', width: 820, height: 1180, mobile: true },
    { name: 'ipad-landscape', width: 1180, height: 820, mobile: true },
    { name: 'desktop', width: 1440, height: 900, mobile: false },
  ];
  for (const viewport of responsiveViewports) {
    await setViewport(cdp, guest, viewport);
    await waitFor(cdp, guest, `window.innerWidth === ${viewport.width}`, `${viewport.name} viewport`);
    const layout = await evaluate(cdp, guest, `(() => {
      const visible = [...document.querySelectorAll('button, a, input')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const horizontalViolations = visible.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      }).map((element) => element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40));
      const touchTargets = [...document.querySelectorAll('.topbar button, .bottomnav button')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => ({
          label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40),
          width: element.getBoundingClientRect().width,
          height: element.getBoundingClientRect().height,
        }));
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        horizontalViolations,
        touchTargets,
        boardWidth: document.querySelector('.board')?.getBoundingClientRect().width || 0,
      };
    })()`);
    if (layout.documentOverflow > 1 || layout.horizontalViolations.length > 0) {
      throw new Error(`${viewport.name} has horizontal overflow: ${JSON.stringify(layout)}`);
    }
    if (viewport.width < 900) {
      const undersized = layout.touchTargets.filter((target) => target.height < 44 || target.width < 44);
      if (undersized.length > 0) throw new Error(`${viewport.name} has undersized shell targets: ${JSON.stringify(undersized)}`);
    }
    if (layout.boardWidth > viewport.width) throw new Error(`${viewport.name} board exceeds viewport width`);
  }

  await clickButton(cdp, host, 'Host or join a room');
  await waitFor(cdp, host, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Create room' && !button.disabled)`, 'post-forfeit socket readiness');
  await clickButton(cdp, host, 'Create room');
  const replacementRoomId = await waitFor(cdp, host, `document.querySelector('.invite-code')?.textContent`, 'post-forfeit room creation');
  const replacementInviteUrl = await evaluate(cdp, host, `document.querySelector('.invite-link').textContent`);
  await clickButton(cdp, host, 'Enter waiting room');
  await waitFor(cdp, host, `document.body.innerText.includes('Waiting for your opponent')`, 'replacement waiting room');
  await clickButton(cdp, host, 'Leave match');
  await waitFor(cdp, host, `document.body.innerText.includes('Leave this waiting room?')`, 'replacement room leave confirmation');
  await clickButton(cdp, host, 'Leave room');
  await waitFor(cdp, host, `Boolean(document.querySelector('.home-screen'))`, 'replacement room deletion');

  await cdp.send('Page.navigate', { url: replacementInviteUrl }, guest.sessionId);
  await waitFor(cdp, guest, `document.querySelector('#join-code')?.value === ${JSON.stringify(replacementRoomId)}`, 'deleted-room invite prefill');
  await waitFor(cdp, guest, `Array.from(document.querySelectorAll('button')).some((button) => button.innerText === 'Join' && !button.disabled)`, 'deleted-room join readiness', 30_000);
  await evaluate(cdp, guest, `document.querySelector('form').requestSubmit(); true`);
  const deletedRoomError = await waitFor(cdp, guest, `document.querySelector('.field-error')?.textContent`, 'deleted-room rejection');
  if (!/no longer exists|room not found/i.test(deletedRoomError)) throw new Error(`Unexpected deleted-room error: ${deletedRoomError}`);

  console.log(JSON.stringify({
    status: 'passed',
    baseUrl,
    roomId,
    inviteUrl,
    inlineError,
    disconnectText,
    board: ['X', null, null, 'O', null, null, null, null, null],
    conflictRoomId,
    conflictExistingRoom,
    waitingLeaveTitle: 'Leave this waiting room?',
    forfeitTitle: 'Forfeit this series?',
    opponentResult,
    replacementRoomId,
    deletedRoomError,
    hostScreenshot,
    guestScreenshot,
  }, null, 2));
} catch (error) {
  console.error(error.stack || error.message);
  if (stderr) console.error(stderr.slice(-4000));
  process.exitCode = 1;
} finally {
  cdp?.close();
  browser?.kill('SIGTERM');
  if (browser?.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      sleep(2000),
    ]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
