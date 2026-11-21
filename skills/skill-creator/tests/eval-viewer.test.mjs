// Security checks for the eval viewer (eval-viewer/generate_review.py and viewer.html).
// Eval outputs, grading and benchmark files are untrusted, and the review server runs while the
// user browses other sites, so each test feeds hostile input or a foreign request.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const viewerDir = resolve(import.meta.dirname, '../eval-viewer');
const script = join(viewerDir, 'generate_review.py');
const HOSTILE = '</script><img src=x onerror="alert(1)">';
const QUOTE_BREAK = '" onmouseover="alert(2)';

function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), 'eval-viewer-'));
  const run = join(ws, 'eval-1', 'with_skill');
  mkdirSync(join(run, 'outputs'), { recursive: true });
  writeFileSync(join(run, 'outputs', 'answer.md'), `Result ${HOSTILE}`);
  writeFileSync(
    join(run, 'eval_metadata.json'),
    JSON.stringify({ eval_id: 1, prompt: `Prompt ${HOSTILE}` }),
  );
  return ws;
}

describe('generate_review.py --static', () => {
  it('embeds untrusted output without letting it close the script element', () => {
    const ws = makeWorkspace();
    try {
      const out = join(ws, 'review.html');
      const result = spawnSync('python3', ['-I', script, ws, '--static', out], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const html = readFileSync(out, 'utf8');
      assert.ok(!html.includes(HOSTILE), 'raw hostile text reached the page');
      assert.ok(html.includes('\\u003c/script\\u003e'), 'the closing tag was not escaped');
      const json = html.match(/const EMBEDDED_DATA = (.*);/)[1];
      assert.equal(
        JSON.parse(json).runs[0].prompt,
        `Prompt ${HOSTILE}`,
        'the data must round-trip',
      );
      assert.ok(!('session_token' in JSON.parse(json)), 'a static page carries no token');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

function send({ port, method = 'GET', path = '/', headers = {}, body }) {
  const length = body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) };
  return new Promise((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: { Host: `127.0.0.1:${port}`, ...length, ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('error', fail);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe('the review server', () => {
  let ws;
  let server;
  let port;
  let token;

  before(async () => {
    ws = makeWorkspace();
    // Port 0 lets the OS pick a free port; BROWSER=true makes webbrowser.open a no-op.
    server = spawn('python3', ['-I', '-u', script, ws, '--port', '0'], {
      env: { ...process.env, BROWSER: 'true' },
    });
    port = await new Promise((done, fail) => {
      let out = '';
      server.stdout.on('data', (chunk) => {
        out += chunk;
        const match = out.match(/URL:\s+http:\/\/localhost:(\d+)/);
        if (match) done(Number(match[1]));
      });
      server.on('exit', (code) => fail(new Error(`server exited with ${code}`)));
    });
    const page = await send({ port });
    token = page.text.match(/"session_token": "([^"]+)"/)[1];
  });

  after(() => {
    server?.kill();
    rmSync(ws, { recursive: true, force: true });
  });

  const feedback = JSON.stringify({ reviews: [{ run_id: 'eval-1-with_skill', feedback: 'ok' }] });
  const goodWrite = () => ({
    'Content-Type': 'application/json',
    Origin: `http://127.0.0.1:${port}`,
    'X-Review-Token': token,
  });

  it('serves its page with a per-run token and nosniff', async () => {
    const page = await send({ port });
    assert.equal(page.status, 200);
    assert.ok(token.length >= 32);
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
  });

  it('answers to localhost as well as 127.0.0.1', async () => {
    const page = await send({ port, headers: { Host: `localhost:${port}` } });
    assert.equal(page.status, 200);
  });

  it('refuses a foreign Host, so a rebound DNS name cannot read outputs or feedback', async () => {
    for (const path of ['/', '/api/feedback']) {
      const res = await send({ port, path, headers: { Host: `attacker.example:${port}` } });
      assert.equal(res.status, 403, path);
      assert.ok(!res.text.includes('Result'), 'no output content in the refusal');
    }
  });

  it('refuses a write without the token, as a cross-site page would send it', async () => {
    const headers = { ...goodWrite() };
    delete headers['X-Review-Token'];
    const res = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers,
      body: feedback,
    });
    assert.equal(res.status, 403);
  });

  it('refuses a write with a wrong token', async () => {
    const headers = { ...goodWrite(), 'X-Review-Token': 'x'.repeat(token.length) };
    const res = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers,
      body: feedback,
    });
    assert.equal(res.status, 403);
  });

  it('refuses a write from a foreign Origin, even with the token', async () => {
    const headers = { ...goodWrite(), Origin: 'https://attacker.example' };
    const res = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers,
      body: feedback,
    });
    assert.equal(res.status, 403);
  });

  it('refuses a write that is not JSON (a simple cross-site request)', async () => {
    const headers = { ...goodWrite(), 'Content-Type': 'text/plain' };
    const res = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers,
      body: feedback,
    });
    assert.equal(res.status, 415);
  });

  it('accepts its own page’s write and saves it', async () => {
    const res = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers: goodWrite(),
      body: feedback,
    });
    assert.equal(res.status, 200, res.text);
    const saved = JSON.parse(readFileSync(join(ws, 'feedback.json'), 'utf8'));
    assert.equal(saved.reviews[0].feedback, 'ok');
  });

  it('accepts a write that sends no Origin (the token alone proves it is its own page)', async () => {
    const headers = { ...goodWrite() };
    delete headers.Origin;
    const res = await send({ port, method: 'POST', path: '/api/feedback', headers, body: feedback });
    assert.equal(res.status, 200, res.text);
  });

  it('answers a non-ASCII token with 403, not a crash', async () => {
    // node:http refuses such a header, so write the request by hand.
    const head = [
      'POST /api/feedback HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(feedback)}`,
      'X-Review-Token: tökén',
      'Connection: close',
      '',
      '',
    ].join('\r\n');
    const reply = await new Promise((done, fail) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(Buffer.concat([Buffer.from(head, 'latin1'), Buffer.from(feedback)]));
      });
      let text = '';
      socket.on('data', (chunk) => (text += chunk));
      socket.on('end', () => done(text));
      socket.on('error', fail);
    });
    assert.match(reply, /^HTTP\/1\.[01] 403 /);
  });

  it('refuses a body over the cap and a length that is not a number', async () => {
    const big = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers: { ...goodWrite(), 'Content-Length': String(6 * 1024 * 1024) },
    });
    assert.equal(big.status, 413);
    const odd = await send({
      port,
      method: 'POST',
      path: '/api/feedback',
      headers: { ...goodWrite(), 'Content-Length': 'abc' },
    });
    assert.equal(odd.status, 413);
  });
});

/** Start a separate process that listens on 127.0.0.1 and report the port it was given. */
async function startHolder() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const s = require('node:net').createServer(); s.listen(0, '127.0.0.1', () => console.log(s.address().port));",
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const held = await new Promise((done, fail) => {
    child.stdout.once('data', (chunk) => done(Number(String(chunk).trim())));
    child.once('exit', (code) => fail(new Error(`holder exited with ${code}`)));
  });
  return { child, port: held };
}

/** Start the viewer on `port` and wait for its URL line. Resolves with the bound port and stdout. */
async function startViewer(ws, port) {
  const child = spawn('python3', ['-I', '-u', script, ws, '--port', String(port)], {
    env: { ...process.env, BROWSER: 'true' },
  });
  let out = '';
  const boundPort = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no URL line from the viewer: ${out}`)), 10_000);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const match = out.match(/URL:\s+http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`viewer exited with ${code}: ${out}`));
    });
  });
  return { child, port: boundPort, stdout: () => out };
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function canConnect(port) {
  return new Promise((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
}

describe('the review server when its port is taken', () => {
  const stops = [];
  const ws = makeWorkspace();

  after(() => {
    for (const child of stops) child.kill();
    rmSync(ws, { recursive: true, force: true });
  });

  it('falls back to a free port and leaves the process holding the port alone', async () => {
    const holder = await startHolder();
    stops.push(holder.child);
    const viewer = await startViewer(ws, holder.port);
    stops.push(viewer.child);

    assert.notEqual(viewer.port, holder.port);
    assert.ok(
      viewer.stdout().includes(`Port ${holder.port} is in use; using ${viewer.port}`),
      `no fallback notice in: ${viewer.stdout()}`,
    );
    const page = await send({ port: viewer.port });
    assert.equal(page.status, 200);
    assert.equal(holder.child.exitCode, null, 'the holder exited');
    assert.equal(holder.child.signalCode, null, `the holder was sent ${holder.child.signalCode}`);
    assert.ok(await canConnect(holder.port), 'the holder no longer accepts connections');
  });

  it('binds the requested port, with no notice, when it is free', async () => {
    const wanted = await freePort();
    const viewer = await startViewer(ws, wanted);
    stops.push(viewer.child);

    assert.equal(viewer.port, wanted);
    assert.ok(!viewer.stdout().includes('is in use'), viewer.stdout());
  });
});

/** The source of `function <name>(...) { ... }` in the viewer's script, braces matched. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `no function ${name}`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

describe('viewer.html rendering', () => {
  const source = readFileSync(join(viewerDir, 'viewer.html'), 'utf8');
  const fns = ['escapeHtml', 'renderGrades', 'renderBenchmark'].map((n) =>
    extractFunction(source, n),
  );

  function render(call, data) {
    const elements = {};
    const element = () => ({
      style: {},
      innerHTML: '',
      classList: { add() {}, remove() {} },
    });
    const document = {
      getElementById: (id) => (elements[id] ??= element()),
    };
    const context = vm.createContext({ document, EMBEDDED_DATA: data });
    vm.runInContext(`${fns.join('\n')}\n${call}`, context);
    return elements;
  }

  const assertInert = (html) => {
    assert.ok(!/<img/i.test(html), `markup injected: ${html}`);
    assert.ok(!/"\s*onmouseover=/i.test(html), `attribute injected: ${html}`);
  };

  it('escapes quotes, so a value cannot leave an attribute', () => {
    const { escapeHtml } = vm.runInNewContext(`${fns[0]}; ({ escapeHtml })`);
    assert.equal(escapeHtml(QUOTE_BREAK), '&quot; onmouseover=&quot;alert(2)');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(3), '3');
  });

  it('renders hostile grading inert', () => {
    const grading = {
      summary: { pass_rate: 0.5, passed: HOSTILE, failed: HOSTILE, total: HOSTILE },
      expectations: [{ text: HOSTILE, passed: false, evidence: QUOTE_BREAK }],
    };
    const els = render(`renderGrades(${JSON.stringify({ grading })})`, {});
    assertInert(els['grades-content'].innerHTML);
  });

  it('renders a hostile benchmark inert, including the values the review named', () => {
    const benchmark = {
      metadata: {
        skill_name: HOSTILE,
        timestamp: HOSTILE,
        evals_run: [HOSTILE],
        runs_per_configuration: HOSTILE,
      },
      run_summary: {
        [`with_${HOSTILE}`]: { pass_rate: { mean: 1, stddev: 0 } },
        without_skill: { pass_rate: { mean: 0, stddev: 0 } },
        delta: { pass_rate: HOSTILE, time_seconds: HOSTILE, tokens: HOSTILE },
      },
      runs: [
        {
          eval_id: 1,
          eval_name: HOSTILE,
          configuration: `with_${HOSTILE}`,
          run_number: HOSTILE,
          result: {
            pass_rate: 1,
            passed: HOSTILE,
            total: HOSTILE,
            errors: HOSTILE,
            time_seconds: 1,
          },
          expectations: [{ text: HOSTILE, passed: true, evidence: QUOTE_BREAK }],
        },
      ],
      notes: [HOSTILE],
    };
    const els = render('renderBenchmark()', { benchmark });
    assertInert(els['benchmark-content'].innerHTML);
  });

  it('keeps only http(s) links from a spreadsheet, and asks SheetJS to sanitise them', () => {
    const links = [
      ['javascript:alert(1)', true],
      [' data:text/html,x', true],
      ['https://example.com', false],
    ].map(([href, strip]) => ({
      href,
      strip,
      removed: false,
      getAttribute: () => href,
      removeAttribute() {
        this.removed = true;
      },
    }));
    let options;
    const context = vm.createContext({
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      XLSX: {
        read: () => ({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } }),
        utils: {
          sheet_to_html: (_ws, opts) => {
            options = opts;
            return '<table></table>';
          },
        },
      },
      document: {
        createElement: () => ({ style: {}, innerHTML: '', querySelectorAll: () => links }),
      },
      container: { appendChild() {}, textContent: '' },
    });
    vm.runInContext(`${extractFunction(source, 'renderXlsx')}\nrenderXlsx(container, 'AA==')`, context);
    assert.equal(options.sanitizeLinks, true);
    for (const link of links) assert.equal(link.removed, link.strip, link.href);
  });

  it('does not report a refused save as saved', async () => {
    const status = { textContent: '' };
    const context = vm.createContext({
      EMBEDDED_DATA: { runs: [{ id: 'r1' }], session_token: 'stale' },
      currentIndex: 0,
      feedbackMap: {},
      document: {
        getElementById: (id) => (id === 'feedback' ? { value: 'looks good' } : status),
      },
      fetch: async () => ({ ok: false, status: 403 }),
    });
    vm.runInContext(`${extractFunction(source, 'saveCurrentFeedback')}\nsaveCurrentFeedback()`, context);
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(status.textContent, 'Not saved: reload the page');
  });
});
