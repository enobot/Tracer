import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { openSecret, sealSecret } from './key-file.mjs';
import {
  CALLBACK_PAGE,
  CALLBACK_PATH,
  ISSUER,
  MODELS_URL,
  RESPONSES_URL,
  assertOpenable,
  authorizationCodeFields,
  buildAuthorizeUrl,
  buildResponsesBody,
  consumeResponseEvents,
  createPkce,
  explainPlanFailure,
  hasPlanSharing,
  normalizeRecord,
  parseCallback,
  parseSseMessage,
  readErrorCode,
  readTokenResponse,
  refreshFields,
  revokeFields,
  selectListedModel,
  splitSse,
  toPublicSession,
  assessIdentityClaims,
} from './chatgpt-plan.mjs';

const HOST_ID = /^urn:uuid:[0-9a-f-]{36}$/i;

function anySignal(signals) {
  const active = signals.filter(Boolean);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active);
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function earliestMs(value, now) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
    }
  }
  return now;
}

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return Buffer.from(value).toString('utf8');
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createChatGPTRuntime({
  fetch: fetchImpl,
  encrypt,
  decrypt,
  readFile,
  writeFile,
  openBrowser,
  storageFile,
  hostIdFile,
  appName = 'Tracer',
  now = () => Date.now(),
}) {
  if (
    typeof fetchImpl !== 'function' ||
    typeof encrypt !== 'function' ||
    typeof decrypt !== 'function' ||
    typeof readFile !== 'function' ||
    typeof writeFile !== 'function' ||
    typeof openBrowser !== 'function'
  ) {
    throw new Error('ChatGPT runtime is missing a required dependency.');
  }

  let discoveryCache;
  let jwksCache;
  let model;
  let phase = 'idle';
  let signInController;
  let requestController;

  const emptyRecord = () =>
    normalizeRecord({ version: 1, status: 'disconnected' });

  const withoutSecrets = (record, status) =>
    normalizeRecord({
      ...record,
      status,
      scopes: [],
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      earliestRefreshAt: null,
    });

  async function loadRecord() {
    let sealed;
    try {
      sealed = await readFile(storageFile);
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRecord();
      throw new Error('The saved ChatGPT connection could not be read.');
    }
    const plain = openSecret(sealed, decrypt);
    if (!plain) return normalizeRecord({ status: 'reauth_required' });
    try {
      return normalizeRecord(JSON.parse(plain));
    } catch {
      return normalizeRecord({ status: 'reauth_required' });
    }
  }

  async function saveRecord(record) {
    const sealed = sealSecret(JSON.stringify(normalizeRecord(record)), encrypt);
    if (!sealed.ok) throw new Error(sealed.error);
    await writeFile(storageFile, sealed.sealed);
  }

  async function hostId() {
    try {
      const existing = textOf(await readFile(hostIdFile)).trim();
      if (HOST_ID.test(existing)) return existing;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error('ChatGPT sign-in could not be saved on this computer.');
      }
    }
    const created = `urn:uuid:${randomUUID()}`;
    await writeFile(hostIdFile, created);
    return created;
  }

  async function discovery(signal) {
    if (discoveryCache) return discoveryCache;
    let response;
    try {
      response = await fetchImpl(`${ISSUER}/.well-known/openid-configuration`, {
        redirect: 'error',
        signal,
        headers: { accept: 'application/json' },
      });
    } catch {
      if (signal?.aborted) throw new Error('Sign-in was cancelled.');
      throw new Error('ChatGPT sign-in configuration could not be verified.');
    }
    const data = await readJson(response);
    const failed = () => {
      throw new Error('ChatGPT sign-in configuration could not be verified.');
    };
    if (!response.ok || !data || data.issuer !== ISSUER) failed();
    const endpoints = {};
    for (const key of [
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'revocation_endpoint',
    ]) {
      let url;
      try {
        url = new URL(data[key]);
      } catch {
        failed();
      }
      if (
        url.origin !== ISSUER ||
        url.username ||
        url.password ||
        url.protocol !== 'https:'
      ) {
        failed();
      }
      endpoints[key] = url.href;
    }
    if (
      new URL(endpoints.authorization_endpoint).pathname !==
      '/api/accounts/authorize'
    ) {
      failed();
    }
    discoveryCache = endpoints;
    return endpoints;
  }

  async function keySet(jwksUri, signal) {
    if (jwksCache && jwksCache.uri === jwksUri && jwksCache.expires > now()) {
      return jwksCache.set;
    }
    let response;
    try {
      response = await fetchImpl(jwksUri, {
        redirect: 'error',
        signal,
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new Error(
        'ChatGPT identity verification is temporarily unavailable. Try again shortly.',
      );
    }
    const body = await readJson(response);
    if (!response.ok || !body || !Array.isArray(body.keys)) {
      throw new Error(
        'ChatGPT identity verification is temporarily unavailable. Try again shortly.',
      );
    }
    const set = createLocalJWKSet(body);
    jwksCache = { uri: jwksUri, set, expires: now() + 10 * 60_000 };
    return set;
  }

  async function verifyIdToken(idToken, clientId, nonce, signal) {
    const provider = await discovery(signal);
    let payload;
    try {
      const verified = await jwtVerify(
        idToken,
        await keySet(provider.jwks_uri, signal),
        {
          issuer: ISSUER,
          audience: clientId,
          algorithms: ['RS256'],
          clockTolerance: 5,
          requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub'],
        },
      );
      payload = verified.payload;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('temporarily unavailable')
      ) {
        throw error;
      }
      throw new Error(
        'The ChatGPT identity could not be verified. Sign in again.',
      );
    }
    const identity = assessIdentityClaims(payload, { clientId, nonce });
    if (!identity.ok) {
      throw new Error(
        'The ChatGPT identity could not be verified. Sign in again.',
      );
    }
    return identity;
  }

  async function postForm(url, params, signal) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });
    } catch {
      if (signal?.aborted) {
        throw new Error(
          phase === 'connecting'
            ? 'Sign-in was cancelled.'
            : 'The request was cancelled.',
        );
      }
      throw new Error(
        'Tracer could not reach ChatGPT. Check your connection and try again.',
      );
    }
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(explainPlanFailure(response.status, readErrorCode(data)));
    }
    return data;
  }

  function listenForCallback({ state, savedClientId, signal }) {
    let settled = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    void result.catch(() => undefined);
    let selectedPort = 0;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) rejectResult(error);
      else resolveResult(value);
    };
    const server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      let url;
      try {
        url = new URL(request.url ?? '/', `http://127.0.0.1:${selectedPort}`);
      } catch {
        response.writeHead(400).end('Invalid request');
        return;
      }
      const host = request.headers.host;
      if (
        request.method !== 'GET' ||
        host !== `127.0.0.1:${selectedPort}` ||
        url.pathname !== CALLBACK_PATH ||
        settled
      ) {
        response.writeHead(404).end('Not found');
        return;
      }
      const parsed = parseCallback(url.searchParams, { state, savedClientId });
      if (!parsed.consume) {
        response.writeHead(400, {
          'Content-Type': 'text/plain; charset=utf-8',
        });
        response.end('Invalid sign-in state.');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(CALLBACK_PAGE);
      if (!parsed.ok) finish(new Error(parsed.error));
      else finish(null, { code: parsed.code, clientId: parsed.clientId });
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    const close = () => {
      finish(new Error('Sign-in was cancelled.'));
      signal?.removeEventListener('abort', onAbort);
      server.closeAllConnections?.();
      server.close();
    };
    const onAbort = () => {
      finish(new Error('Sign-in was cancelled.'));
      close();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    return {
      result,
      close,
      ready: new Promise((resolve, reject) => {
        server.once('error', () => {
          reject(
            new Error(
              'The sign-in port is unavailable. Close another copy of Tracer and try again.',
            ),
          );
        });
        server.listen({ port: 0, host: '127.0.0.1' }, () => {
          const address = server.address();
          selectedPort =
            typeof address === 'object' && address ? address.port : 0;
          resolve(`http://127.0.0.1:${selectedPort}${CALLBACK_PATH}`);
        });
      }),
    };
  }

  return {
    async getSession() {
      if (phase === 'connecting') {
        return {
          status: 'connecting',
          sharing: false,
          email: null,
          name: null,
          modelName: null,
        };
      }
      try {
        return toPublicSession(await loadRecord(), model?.displayName ?? null);
      } catch {
        return toPublicSession({ status: 'reauth_required' });
      }
    },

    cancelSignIn() {
      signInController?.abort();
    },

    cancelRespond() {
      requestController?.abort();
    },

    async signIn({ reconsent = false, signal: callerSignal } = {}) {
      if (phase === 'connecting' || signInController) {
        throw new Error(
          'Finish the ChatGPT sign-in already open in your browser.',
        );
      }
      if (requestController) {
        throw new Error(
          'Finish the current ChatGPT request before signing in.',
        );
      }
      const probe = sealSecret('ready', encrypt);
      if (!probe.ok) throw new Error(probe.error);
      signInController = new AbortController();
      const signal = anySignal([
        signInController.signal,
        callerSignal,
        AbortSignal.timeout(5 * 60_000),
      ]);
      phase = 'connecting';
      let listener;
      try {
        const persistedHostId = await hostId();
        const record = await loadRecord();
        const provider = await discovery(signal);
        const pkce = createPkce();
        listener = listenForCallback({
          state: pkce.state,
          savedClientId: record.clientId,
          signal,
        });
        const redirectUri = await listener.ready;
        const authorize = assertOpenable(
          buildAuthorizeUrl({
            authorizationEndpoint: provider.authorization_endpoint,
            clientId: record.clientId,
            redirectUri,
            state: pkce.state,
            nonce: pkce.nonce,
            codeChallenge: pkce.challenge,
            hostId: persistedHostId,
            appName,
            loginHint: record.email,
            reconsent,
          }),
          { authorize: true },
        );
        try {
          await openBrowser(authorize);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === 'Refusing to open that address.'
          ) {
            throw error;
          }
          throw new Error(
            'The browser could not be opened. Check your default browser and try again.',
          );
        }
        const callback = await listener.result;
        if (record.status !== 'connected') {
          await saveRecord({
            ...record,
            status: 'pending',
            clientId: callback.clientId,
            scopes: [],
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
          });
        }
        const token = readTokenResponse(
          await postForm(
            provider.token_endpoint,
            authorizationCodeFields({
              clientId: callback.clientId,
              code: callback.code,
              verifier: pkce.verifier,
              redirectUri,
            }),
            anySignal([signal, AbortSignal.timeout(20_000)]),
          ),
          { now: now(), requireIdToken: true },
        );
        if (!token.ok) throw new Error(token.error);
        const identity = await verifyIdToken(
          token.idToken,
          callback.clientId,
          pkce.nonce,
          signal,
        );
        if (record.subject && identity.subject !== record.subject) {
          throw new Error(
            'This sign-in returned a different ChatGPT account. Sign in to the original account, or disconnect first.',
          );
        }
        model = null;
        await saveRecord({
          version: 1,
          status: 'connected',
          clientId: callback.clientId,
          subject: identity.subject,
          email: identity.email,
          name: identity.name,
          scopes: token.scopes,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          earliestRefreshAt: token.earliestRefreshAt,
        });
        return toPublicSession(await loadRecord());
      } finally {
        listener?.close();
        phase = 'idle';
        signInController = undefined;
      }
    },

    async disconnect() {
      this.cancelSignIn();
      this.cancelRespond();
      phase = 'idle';
      model = null;
      const record = await loadRecord();
      let revocationFailed = false;
      if (record.refreshToken && record.clientId) {
        try {
          const provider = await discovery(AbortSignal.timeout(15_000));
          const response = await fetchImpl(provider.revocation_endpoint, {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: revokeFields({
              clientId: record.clientId,
              refreshToken: record.refreshToken,
            }),
          });
          await response.body?.cancel?.().catch(() => undefined);
          if (response.status !== 200) revocationFailed = true;
        } catch {
          revocationFailed = true;
        }
      }
      await saveRecord(withoutSecrets(record, 'disconnected'));
      if (revocationFailed) {
        throw new Error(
          'Local ChatGPT credentials were removed, but remote disconnection could not be confirmed. Disconnect Tracer in ChatGPT settings.',
        );
      }
      return toPublicSession(await loadRecord());
    },

    async respond(messages, callerSignal) {
      if (phase === 'connecting') {
        throw new Error(
          'Finish the ChatGPT sign-in already open in your browser.',
        );
      }
      if (requestController) {
        throw new Error('A ChatGPT request is already running.');
      }
      requestController = new AbortController();
      const signal = anySignal([
        callerSignal,
        requestController.signal,
        AbortSignal.timeout(90_000),
      ]);
      try {
        let record = await loadRecord();
        if (record.status !== 'connected' || !record.accessToken) {
          throw new Error('Sign in with ChatGPT before analyzing.');
        }
        if (!hasPlanSharing(record.scopes)) {
          throw new Error(explainPlanFailure(0, 'sharing_not_enabled'));
        }
        record = await freshRecord(record, signal);
        if (!hasPlanSharing(record.scopes)) {
          throw new Error(explainPlanFailure(0, 'sharing_not_enabled'));
        }
        const selected =
          model ?? (await listedModel(record.accessToken, signal));
        model = selected;
        const built = buildResponsesBody({
          model: selected.slug,
          messages,
        });
        if (!built.ok) throw new Error(built.error);
        let response;
        try {
          response = await fetchImpl(RESPONSES_URL, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              accept: 'text/event-stream',
              authorization: `Bearer ${record.accessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(built.body),
          });
        } catch {
          if (signal.aborted) throw new Error('The request was cancelled.');
          throw new Error(
            'Tracer could not reach ChatGPT. Check your connection and try again.',
          );
        }
        if (!response.ok) {
          const data = await readJson(response);
          const code = readErrorCode(data);
          if (response.status === 401 || code === 'invalid_grant') {
            model = null;
            await saveRecord(withoutSecrets(record, 'reauth_required'));
          }
          throw new Error(explainPlanFailure(response.status, code));
        }
        const contentType =
          response.headers
            .get('content-type')
            ?.split(';')[0]
            ?.trim()
            .toLowerCase() ?? '';
        if (contentType && contentType !== 'text/event-stream') {
          await response.body?.cancel?.().catch(() => undefined);
          throw new Error(
            'ChatGPT did not return the expected response stream. Try again.',
          );
        }
        const answer = await readStream(response, signal);
        if (!answer.ok) throw new Error(answer.error);
        return { text: answer.text, modelName: selected.displayName };
      } finally {
        requestController = undefined;
      }
    },
  };

  async function freshRecord(record, signal) {
    if (record.expiresAt > now() + 60_000) return record;
    if (!record.refreshToken || !record.clientId) {
      await saveRecord(withoutSecrets(record, 'reauth_required'));
      throw new Error('ChatGPT sign-in expired. Sign in again.');
    }
    if (
      record.expiresAt <= now() &&
      earliestMs(record.earliestRefreshAt, now()) > now()
    ) {
      throw new Error(
        'ChatGPT cannot refresh this connection yet. Try again shortly.',
      );
    }
    const provider = await discovery(signal);
    let data;
    try {
      data = await postForm(
        provider.token_endpoint,
        refreshFields({
          clientId: record.clientId,
          refreshToken: record.refreshToken,
        }),
        anySignal([signal, AbortSignal.timeout(20_000)]),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'ChatGPT sign-in expired. Sign in again.'
      ) {
        await saveRecord(withoutSecrets(record, 'reauth_required'));
      }
      throw error;
    }
    const token = readTokenResponse(data, {
      now: now(),
      previousScopes: record.scopes,
    });
    if (!token.ok) throw new Error(token.error);
    if (token.idToken) {
      const identity = await verifyIdToken(
        token.idToken,
        record.clientId,
        undefined,
        signal,
      );
      if (record.subject && identity.subject !== record.subject) {
        await saveRecord(withoutSecrets(record, 'reauth_required'));
        throw new Error(
          'The refreshed ChatGPT identity does not match this account. Sign in again.',
        );
      }
    }
    const next = normalizeRecord({
      ...record,
      status: 'connected',
      scopes: token.scopes,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? record.refreshToken,
      expiresAt: token.expiresAt,
      earliestRefreshAt: token.earliestRefreshAt,
    });
    await saveRecord(next);
    return next;
  }

  async function listedModel(accessToken, signal) {
    let response;
    try {
      response = await fetchImpl(MODELS_URL, {
        redirect: 'error',
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${accessToken}`,
        },
      });
    } catch {
      if (signal.aborted) throw new Error('The request was cancelled.');
      throw new Error(
        'Tracer could not reach ChatGPT. Check your connection and try again.',
      );
    }
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(explainPlanFailure(response.status, readErrorCode(data)));
    }
    const selected = selectListedModel(data);
    if (!selected.ok) throw new Error(selected.error);
    return selected.model;
  }

  async function readStream(response, signal) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new Error(
        'ChatGPT did not return the expected response stream. Try again.',
      );
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const events = [];
    while (true) {
      if (signal.aborted) throw new Error('The request was cancelled.');
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        if (signal.aborted) throw new Error('The request was cancelled.');
        throw new Error('The connection was interrupted. Try again.');
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 2_000_000) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          error: 'The response was too large. Try a smaller request.',
        };
      }
      const split = splitSse(buffer);
      buffer = split.rest;
      for (const block of split.blocks) {
        const event = parseSseMessage(block);
        if (!event || event.type === 'done') continue;
        events.push(event);
        if (
          event.type === 'response.completed' ||
          event.type === 'response.failed' ||
          event.type === 'response.incomplete' ||
          event.type === 'error'
        ) {
          await reader.cancel().catch(() => undefined);
          return consumeResponseEvents(events);
        }
      }
    }
    if (buffer.trim()) {
      const event = parseSseMessage(buffer);
      if (event && event.type !== 'done') events.push(event);
    }
    return consumeResponseEvents(events);
  }
}
