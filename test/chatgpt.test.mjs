import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { parseMarkdown } from '../src/markdown-blocks.mjs';
import {
  CALLBACK_PAGE,
  HANDOFF_TARGETS,
  USAGE_URL,
  assertOpenable,
  buildAuthorizeUrl,
  buildConversation,
  buildResponsesBody,
  consumeResponseEvents,
  createPkce,
  explainPlanFailure,
  handoffUrl,
  hasPlanSharing,
  parseCallback,
  readErrorCode,
  selectListedModel,
  toPublicSession,
} from '../src/chatgpt-plan.mjs';
import { createChatGPTRuntime } from '../src/chatgpt-runtime.mjs';

const SHOT = 'data:image/jpeg;base64,aaaa';

function memoryFiles() {
  const files = new Map();
  return {
    files,
    async readFile(file) {
      if (!files.has(file)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return files.get(file);
    },
    async writeFile(file, data) {
      files.set(file, Buffer.from(data));
    },
  };
}

describe('ChatGPT plan requests', () => {
  it('builds a loopback PKCE authorize URL without a client secret', () => {
    const pkce = createPkce();
    const url = new URL(
      buildAuthorizeUrl({
        authorizationEndpoint: 'https://auth.openai.com/api/accounts/authorize',
        redirectUri: 'http://127.0.0.1:4312/auth/callback',
        state: pkce.state,
        nonce: pkce.nonce,
        codeChallenge: pkce.challenge,
        hostId: 'urn:uuid:11111111-1111-1111-1111-111111111111',
        appName: 'Tracer',
      }),
    );
    assert.equal(url.origin, 'https://auth.openai.com');
    assert.equal(url.pathname, '/api/accounts/authorize');
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
      url.searchParams.get('code_challenge'),
      createHash('sha256').update(pkce.verifier).digest('base64url'),
    );
    assert.match(url.searchParams.get('scope'), /chatgpt\.tokens\.use\.direct/);
    assert.equal(url.searchParams.get('agent_name_hint'), 'Tracer');
    assert.equal(url.searchParams.has('client_secret'), false);
    assert.equal(url.searchParams.has('id_token'), false);
    const redirect = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(redirect.protocol, 'http:');
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(redirect.pathname, '/auth/callback');
  });

  it('rejects a mismatched state and the placeholder client id', () => {
    const mismatch = parseCallback('code=abc&state=other', {
      state: 'expected',
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.consume, false);
    const placeholder = parseCallback(
      'code=abc&state=expected&client_id=dynamic_agent_client',
      { state: 'expected' },
    );
    assert.equal(placeholder.ok, false);
    assert.equal(placeholder.consume, true);
    const changed = parseCallback(
      'code=abc&state=expected&client_id=oaiapp_other',
      { state: 'expected', savedClientId: 'oaiapp_saved' },
    );
    assert.equal(changed.ok, false);
  });

  it('keeps plan sharing off until the direct-use scope is granted', () => {
    assert.equal(hasPlanSharing(['openid', 'profile']), false);
    const hidden = toPublicSession({
      status: 'connected',
      scopes: ['openid'],
      email: 'ada@example.com',
      accessToken: 'secret-token',
    });
    assert.equal(hidden.sharing, false);
    assert.equal(JSON.stringify(hidden).includes('secret-token'), false);
    assert.deepEqual(Object.keys(hidden).sort(), [
      'email',
      'modelName',
      'name',
      'savedAccount',
      'sharing',
      'status',
    ]);
    assert.equal(hidden.savedAccount, false);
  });

  it('sends the screenshot as an image on the plan Responses route', () => {
    const conversation = buildConversation({
      screenshot: SHOT,
      prompt: 'What changed?',
      history: [
        { role: 'user', text: 'What is this?' },
        { role: 'assistant', text: 'A window.' },
      ],
    });
    const built = buildResponsesBody({
      model: 'gpt-test',
      messages: conversation.messages,
    });
    assert.equal(built.ok, true);
    assert.equal(built.body.store, false);
    assert.equal(built.body.stream, true);
    assert.equal(built.body.previous_response_id, undefined);
    assert.equal(built.body.temperature, undefined);
    assert.equal(built.body.max_output_tokens, undefined);
    assert.equal(built.body.user, undefined);
    assert.equal(built.body.input[0].content[1].type, 'input_image');
    assert.equal(built.body.input[0].content[1].image_url, SHOT);
    assert.equal(built.body.input[2].content.length, 1);
    assert.equal(JSON.stringify(built.body).includes('secret-token'), false);
    assert.equal(
      selectListedModel({
        models: [
          { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
          { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' },
        ],
      }).model.slug,
      'gpt-test',
    );
  });

  it('maps plan errors without repeating response text', () => {
    assert.equal(
      readErrorCode({
        error: { message: 'Bearer should-not-surface', code: 'invalid_grant' },
      }),
      'invalid_grant',
    );
    const message = explainPlanFailure(400, 'invalid_grant');
    assert.equal(message.includes('should-not-surface'), false);
    assert.match(message, /Sign in again/);
    const limited = consumeResponseEvents([
      {
        type: 'response.failed',
        response: {
          error: {
            code: 'subscription_sharing_usage_limit_exceeded',
            message: 'Bearer should-not-surface',
          },
        },
      },
    ]);
    assert.equal(limited.ok, false);
    assert.match(limited.error, /plan allowance/);
    assert.equal(limited.error.includes('should-not-surface'), false);
  });

  it('explains the error codes in OpenAI errors-and-recovery accurately', () => {
    // A temporary outage must not tell the user their account is ineligible.
    assert.match(
      explainPlanFailure(503, 'subscription_sharing_usage_unavailable'),
      /temporarily unavailable/,
    );
    assert.match(
      explainPlanFailure(503, 'subscription_sharing_user_unavailable'),
      /temporarily unavailable/,
    );
    const ineligible = explainPlanFailure(
      403,
      'subscription_sharing_user_not_eligible',
    );
    assert.match(ineligible, /cannot use its plan/);
    assert.doesNotMatch(ineligible, /Allow plan usage/);
    assert.match(
      explainPlanFailure(400, 'subscription_sharing_unsupported_capability'),
      /image input/,
    );
    // Final refresh errors arrive as HTTP 400 from the token endpoint.
    for (const code of [
      'invalid_grant',
      'invalid_refresh_token',
      'token_expired',
      'refresh_token_expired',
      'refresh_token_invalidated',
      'refresh_token_reused',
    ]) {
      assert.equal(
        explainPlanFailure(400, code),
        'ChatGPT sign-in expired. Sign in again.',
        code,
      );
    }
  });

  it('looks up handoff sites by own key only', () => {
    assert.equal(handoffUrl('gemini'), HANDOFF_TARGETS.gemini);
    assert.equal(handoffUrl('claude'), HANDOFF_TARGETS.claude);
    for (const provider of [
      '__proto__',
      'constructor',
      'toString',
      'chatgpt',
      undefined,
      { toString: () => 'gemini' },
    ]) {
      assert.equal(handoffUrl(provider), null);
    }
  });

  it('opens only the official handoff and usage pages', () => {
    assert.equal(assertOpenable(USAGE_URL), USAGE_URL);
    assert.equal(
      assertOpenable(HANDOFF_TARGETS.gemini),
      HANDOFF_TARGETS.gemini,
    );
    assert.equal(
      assertOpenable(HANDOFF_TARGETS.claude),
      HANDOFF_TARGETS.claude,
    );
    for (const url of [
      'https://evil.example/app',
      'https://chatgpt.com/backend-api/conversation',
      'https://gemini.google.com/app?next=https://evil.example',
      'javascript:alert(1)',
      'http://127.0.0.1/auth/callback',
    ]) {
      assert.throws(() => assertOpenable(url), /Refusing to open that address/);
    }
    assert.equal(CALLBACK_PAGE.includes('code'), false);
    assert.equal(CALLBACK_PAGE.includes('$'), false);
  });

  it('renders model text as blocks instead of HTML', () => {
    const blocks = parseMarkdown(
      'See <script>alert(1)</script>\n\n```\nconst x = 1;\n```',
    );
    assert.equal(
      blocks.every((block) =>
        ['paragraph', 'list', 'code'].includes(block.type),
      ),
      true,
    );
    assert.equal(JSON.stringify(blocks).includes('<script'), true);
    assert.equal(
      blocks.some((block) => block.type === 'html'),
      false,
    );
  });
});

describe('ChatGPT sign-in runtime', () => {
  async function keys() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'tracer-test';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    return { privateKey, jwk };
  }

  function runtimeFor(fetchImpl, openBrowser) {
    const disk = memoryFiles();
    const runtime = createChatGPTRuntime({
      fetch: fetchImpl,
      encrypt: (plain) => Buffer.from(plain),
      decrypt: (sealed) => Buffer.from(sealed).toString('utf8'),
      readFile: disk.readFile,
      writeFile: disk.writeFile,
      openBrowser,
      storageFile: 'connection',
      hostIdFile: 'host',
      now: () => 1_700_000_000_000,
    });
    return { runtime, disk };
  }

  it('signs in, analyzes an image, and disconnects without exposing tokens', async () => {
    const { privateKey, jwk } = await keys();
    const calls = [];
    let nonce = '';
    let authorizeUrl = '';
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: 'https://auth.openai.com',
          authorization_endpoint:
            'https://auth.openai.com/api/accounts/authorize',
          token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
          revocation_endpoint:
            'https://auth.openai.com/api/accounts/oauth/revoke',
          jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        });
      }
      if (href.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      if (href.endsWith('/oauth/token')) {
        const idToken = await new SignJWT({
          name: 'Ada',
          email: 'ada@example.com',
          nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'tracer-test' })
          .setIssuer('https://auth.openai.com')
          .setAudience('oaiapp_testclient')
          .setSubject('account-1')
          .setIssuedAt()
          .setExpirationTime('2h')
          .sign(privateKey);
        return Response.json({
          access_token: 'access-test-token',
          refresh_token: 'refresh-test-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope:
            'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
          id_token: idToken,
        });
      }
      if (href.endsWith('/v1/models')) {
        return Response.json({
          models: [
            { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
            { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' },
          ],
        });
      }
      if (href.endsWith('/v1/responses')) {
        const raw = [
          { type: 'response.output_text.delta', delta: 'Hello ' },
          { type: 'response.output_text.delta', delta: 'screen' },
          { type: 'response.completed' },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join('');
        return new Response(raw, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (href.endsWith('/oauth/revoke'))
        return new Response(null, { status: 200 });
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async (url) => {
      authorizeUrl = url;
      const auth = new URL(url);
      nonce = auth.searchParams.get('nonce');
      const redirect = new URL(auth.searchParams.get('redirect_uri'));
      const wrong = new URL(redirect);
      wrong.searchParams.set('state', 'not-the-state');
      wrong.searchParams.set('code', 'bad-code');
      const rejected = await fetch(wrong);
      assert.equal(rejected.status, 400);
      redirect.searchParams.set('code', 'test-code');
      redirect.searchParams.set('state', auth.searchParams.get('state'));
      redirect.searchParams.set('client_id', 'oaiapp_testclient');
      const accepted = await fetch(redirect);
      const page = await accepted.text();
      assert.equal(accepted.status, 200);
      assert.equal(page.includes('test-code'), false);
    });

    const session = await runtime.signIn({
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(session.status, 'connected');
    assert.equal(session.sharing, true);
    assert.equal(session.email, 'ada@example.com');
    assert.equal(JSON.stringify(session).includes('access-test-token'), false);
    const auth = new URL(authorizeUrl);
    assert.equal(auth.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(auth.searchParams.has('client_secret'), false);
    assert.equal(
      new URL(auth.searchParams.get('redirect_uri')).hostname,
      '127.0.0.1',
    );
    const tokenCall = calls.find((call) => call.href.endsWith('/oauth/token'));
    assert.equal(tokenCall.options.body.get('client_id'), 'oaiapp_testclient');
    assert.equal(tokenCall.options.body.has('client_secret'), false);
    assert.equal(
      tokenCall.options.body.get('resource'),
      'https://api.openai.com/v1',
    );

    const answer = await runtime.respond([
      { role: 'user', text: 'What is this?', image: SHOT },
    ]);
    assert.equal(answer.text, 'Hello screen');
    assert.equal(answer.modelName, 'GPT Test');
    const responseCall = calls.find((call) =>
      call.href.endsWith('/v1/responses'),
    );
    const body = JSON.parse(responseCall.options.body);
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.input[0].content[1].type, 'input_image');
    assert.equal(body.input[0].content[1].image_url, SHOT);
    assert.equal(
      responseCall.options.headers.authorization,
      'Bearer access-test-token',
    );
    assert.equal(
      responseCall.options.body.includes('access-test-token'),
      false,
    );

    const stored = JSON.parse(disk.files.get('connection').toString());
    stored.scopes = ['openid'];
    disk.files.set('connection', Buffer.from(JSON.stringify(stored)));
    const before = calls.length;
    await assert.rejects(
      () => runtime.respond([{ role: 'user', text: 'Again', image: SHOT }]),
      /plan usage is not enabled/,
    );
    assert.equal(
      calls.slice(before).some((call) => call.href.endsWith('/v1/responses')),
      false,
    );

    stored.scopes = [
      'openid',
      'offline_access',
      'resource.invoke',
      'chatgpt.tokens.use.direct',
    ];
    disk.files.set('connection', Buffer.from(JSON.stringify(stored)));
    const disconnected = await runtime.disconnect();
    assert.equal(disconnected.sharing, false);
    assert.equal(disconnected.status, 'disconnected');
    const revoke = calls.find((call) => call.href.endsWith('/oauth/revoke'));
    assert.equal(revoke.options.body.get('token'), 'refresh-test-token');
    assert.equal(revoke.options.body.get('token_type_hint'), 'refresh_token');
    const cleared = JSON.parse(disk.files.get('connection').toString());
    assert.equal(cleared.accessToken, null);
    assert.equal(cleared.refreshToken, null);
  });

  const NOW = 1_700_000_000_000;
  const PLAN_SCOPES = [
    'openid',
    'offline_access',
    'resource.invoke',
    'chatgpt.tokens.use.direct',
  ];

  function providerConfig() {
    return Response.json({
      issuer: 'https://auth.openai.com',
      authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize',
      token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
      revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
      jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
    });
  }

  function seedConnection(disk, overrides = {}) {
    disk.files.set(
      'connection',
      Buffer.from(
        JSON.stringify({
          version: 1,
          status: 'connected',
          clientId: 'oaiapp_testclient',
          subject: 'account-1',
          email: 'ada@example.com',
          scopes: PLAN_SCOPES,
          accessToken: 'access-test-token',
          refreshToken: 'refresh-test-token',
          expiresAt: NOW + 3_600_000,
          earliestRefreshAt: null,
          ...overrides,
        }),
      ),
    );
  }

  const listedModels = () =>
    Response.json({
      models: [
        { slug: 'gpt-test', display_name: 'GPT Test', visibility: 'list' },
      ],
    });

  const callsTo = (calls, suffix) =>
    calls.filter((call) => call.href.endsWith(suffix));

  function sseAnswer(text) {
    const raw = [
      { type: 'response.output_text.delta', delta: text },
      { type: 'response.completed' },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('');
    return new Response(raw, {
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  const refreshedTokens = () =>
    Response.json({
      access_token: 'access-new',
      refresh_token: 'refresh-rotated',
      token_type: 'Bearer',
      expires_in: 3600,
    });

  it('clears tokens and asks for sign-in when the refresh token has expired', async () => {
    // Refresh tokens last 30 days, so this is what a returning user hits.
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return providerConfig();
      }
      if (href.endsWith('/oauth/token')) {
        return Response.json(
          { error: { code: 'refresh_token_expired', message: 'expired' } },
          { status: 400 },
        );
      }
      if (href.endsWith('/oauth/revoke')) return new Response(null);
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async () => {});
    seedConnection(disk, { expiresAt: NOW - 1000 });
    await assert.rejects(
      () => runtime.respond([{ role: 'user', text: 'Hi', image: SHOT }]),
      /Sign in again/,
    );
    assert.equal(
      callsTo(calls, '/oauth/revoke')[0].options.body.get('token'),
      'refresh-test-token',
      'revoked before it was forgotten',
    );
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.status, 'reauth_required');
    assert.equal(stored.accessToken, null);
    assert.equal(stored.refreshToken, null);
    assert.equal(
      stored.clientId,
      'oaiapp_testclient',
      'keeps the issued client',
    );
    assert.equal(callsTo(calls, '/v1/responses').length, 0);
    assert.equal((await runtime.getSession()).status, 'reauth_required');
  });

  it('refreshes once and retries when ChatGPT rejects the access token', async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return providerConfig();
      }
      if (href.endsWith('/oauth/token')) return refreshedTokens();
      if (href.endsWith('/v1/models')) return listedModels();
      if (href.endsWith('/v1/responses')) {
        return options.headers.authorization === 'Bearer access-new'
          ? sseAnswer('Hello again')
          : Response.json(
              { error: { code: 'subscription_sharing_invalid_user' } },
              { status: 401 },
            );
      }
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async () => {});
    seedConnection(disk);
    const answer = await runtime.respond([
      { role: 'user', text: 'Hi', image: SHOT },
    ]);
    assert.equal(answer.text, 'Hello again');
    const [refresh] = callsTo(calls, '/oauth/token');
    assert.equal(refresh.options.body.get('grant_type'), 'refresh_token');
    assert.equal(
      refresh.options.body.get('refresh_token'),
      'refresh-test-token',
    );
    assert.equal(callsTo(calls, '/v1/responses').length, 2);
    assert.equal(callsTo(calls, '/oauth/revoke').length, 0);
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.status, 'connected');
    assert.equal(stored.accessToken, 'access-new');
    assert.equal(stored.refreshToken, 'refresh-rotated');
  });

  it('revokes, then clears, a connection ChatGPT still rejects after a refresh', async () => {
    const calls = [];
    let disk;
    let storedAtRevoke;
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return providerConfig();
      }
      if (href.endsWith('/oauth/token')) return refreshedTokens();
      if (href.endsWith('/v1/models')) return listedModels();
      if (href.endsWith('/v1/responses')) {
        return new Response(null, { status: 401 });
      }
      if (href.endsWith('/oauth/revoke')) {
        storedAtRevoke = JSON.parse(disk.files.get('connection').toString());
        return new Response(null);
      }
      throw new Error(`unexpected ${href}`);
    };
    const made = runtimeFor(fetchImpl, async () => {});
    disk = made.disk;
    seedConnection(disk);
    await assert.rejects(
      () => made.runtime.respond([{ role: 'user', text: 'Hi', image: SHOT }]),
      /^Error: ChatGPT did not accept this connection\. Sign in again\.$/,
    );
    assert.equal(callsTo(calls, '/v1/responses').length, 2, 'one retry only');
    assert.equal(
      callsTo(calls, '/oauth/revoke')[0].options.body.get('token'),
      'refresh-rotated',
      'the newest refresh token is revoked',
    );
    assert.equal(storedAtRevoke.refreshToken, 'refresh-rotated');
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.status, 'reauth_required');
    assert.equal(stored.accessToken, null);
    assert.equal(stored.refreshToken, null);
    assert.equal(stored.clientId, 'oaiapp_testclient');
  });

  it('keeps the connection when a rejected token cannot be refreshed right now', async () => {
    // OpenAI: do not delete credentials because of a temporary failure.
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return providerConfig();
      }
      if (href.endsWith('/oauth/token')) {
        return Response.json(
          { error: { code: 'server_error' } },
          { status: 503 },
        );
      }
      if (href.endsWith('/v1/models')) return listedModels();
      if (href.endsWith('/v1/responses')) {
        return new Response(null, { status: 401 });
      }
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async () => {});
    seedConnection(disk);
    await assert.rejects(
      () => runtime.respond([{ role: 'user', text: 'Hi', image: SHOT }]),
      /unavailable right now/,
    );
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.status, 'connected');
    assert.equal(stored.accessToken, 'access-test-token');
    assert.equal(stored.refreshToken, 'refresh-test-token');
    assert.equal(callsTo(calls, '/oauth/revoke').length, 0);
    assert.equal(callsTo(calls, '/v1/responses').length, 1);
  });

  // A fake OpenAI that completes sign-in for `subject` with `clientId`.
  function oauthServer({ privateKey, jwk, clientId, subject, email, calls }) {
    let nonce = '';
    let failExchange = false;
    let onAuthorize = () => {};
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      calls.push({ href, options });
      if (href.endsWith('/.well-known/openid-configuration')) {
        return providerConfig();
      }
      if (href.endsWith('/jwks.json')) return Response.json({ keys: [jwk] });
      if (href.endsWith('/oauth/revoke')) return new Response(null);
      if (href.endsWith('/oauth/token')) {
        if (failExchange) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        const idToken = await new SignJWT({ email, nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'tracer-test' })
          .setIssuer('https://auth.openai.com')
          .setAudience(clientId)
          .setSubject(subject)
          .setIssuedAt()
          .setExpirationTime('2h')
          .sign(privateKey);
        return Response.json({
          access_token: `access-${subject}`,
          refresh_token: `refresh-${subject}`,
          token_type: 'Bearer',
          expires_in: 3600,
          scope: PLAN_SCOPES.join(' '),
          id_token: idToken,
        });
      }
      throw new Error(`unexpected ${href}`);
    };
    const openBrowser = async (url) => {
      const auth = new URL(url);
      nonce = auth.searchParams.get('nonce');
      onAuthorize(auth);
      const redirect = new URL(auth.searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'test-code');
      redirect.searchParams.set('state', auth.searchParams.get('state'));
      redirect.searchParams.set('client_id', clientId);
      await fetch(redirect);
    };
    return {
      fetchImpl,
      openBrowser,
      failExchange: () => {
        failExchange = true;
      },
      onAuthorize: (hook) => {
        onAuthorize = hook;
      },
    };
  }

  it('signs in a different account and revokes the old one only after the new identity checks out', async () => {
    const { privateKey, jwk } = await keys();
    const calls = [];
    const server = oauthServer({
      privateKey,
      jwk,
      calls,
      clientId: 'oaiapp_second',
      subject: 'account-2',
      email: 'grace@example.com',
    });
    const { runtime, disk } = runtimeFor(server.fetchImpl, server.openBrowser);
    seedConnection(disk);
    const before = disk.files.get('connection').toString();
    let storedDuringBrowser;
    server.onAuthorize((auth) => {
      // A new registration: no saved client id and no hint of the old email.
      assert.equal(auth.searchParams.get('client_id'), 'dynamic_agent_client');
      assert.equal(auth.searchParams.get('agent_name_hint'), 'Tracer');
      assert.equal(auth.searchParams.has('login_hint'), false);
      storedDuringBrowser = disk.files.get('connection').toString();
    });
    const session = await runtime.signIn({
      fresh: true,
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(session.status, 'connected');
    assert.equal(session.email, 'grace@example.com');
    assert.equal(session.notice, undefined);
    assert.equal(
      storedDuringBrowser,
      before,
      'old account untouched meanwhile',
    );
    const order = calls.map((call) => call.href);
    const [revoke] = callsTo(calls, '/oauth/revoke');
    assert.equal(revoke.options.body.get('token'), 'refresh-test-token');
    assert.equal(revoke.options.body.get('client_id'), 'oaiapp_testclient');
    assert.ok(
      order.findLastIndex((href) => href.endsWith('/oauth/revoke')) >
        order.findLastIndex((href) => href.endsWith('/jwks.json')),
      'revoked after the new ID token was verified',
    );
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.clientId, 'oaiapp_second');
    assert.equal(stored.subject, 'account-2');
    assert.equal(stored.refreshToken, 'refresh-account-2');
  });

  it('keeps the remembered account when signing in a different one fails', async () => {
    const { privateKey, jwk } = await keys();
    const calls = [];
    const server = oauthServer({
      privateKey,
      jwk,
      calls,
      clientId: 'oaiapp_second',
      subject: 'account-2',
      email: 'grace@example.com',
    });
    server.failExchange();
    const { runtime, disk } = runtimeFor(server.fetchImpl, server.openBrowser);
    seedConnection(disk, {
      status: 'disconnected',
      scopes: [],
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    });
    const before = disk.files.get('connection').toString();
    await assert.rejects(
      () => runtime.signIn({ fresh: true, signal: AbortSignal.timeout(5000) }),
      /Sign in again/,
    );
    assert.equal(disk.files.get('connection').toString(), before);
    assert.equal(callsTo(calls, '/oauth/revoke').length, 0);
    assert.equal((await runtime.getSession()).savedAccount, true);
  });

  it('points a normal sign-in that returns another account to the switch', async () => {
    const { privateKey, jwk } = await keys();
    const calls = [];
    const server = oauthServer({
      privateKey,
      jwk,
      calls,
      clientId: 'oaiapp_testclient',
      subject: 'account-2',
      email: 'grace@example.com',
    });
    const { runtime, disk } = runtimeFor(server.fetchImpl, server.openBrowser);
    seedConnection(disk, {
      status: 'disconnected',
      scopes: [],
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
    });
    let authorize;
    server.onAuthorize((auth) => {
      authorize = auth;
    });
    await assert.rejects(
      () => runtime.signIn({ signal: AbortSignal.timeout(5000) }),
      /Use a different ChatGPT account/,
    );
    assert.equal(authorize.searchParams.get('client_id'), 'oaiapp_testclient');
    assert.equal(authorize.searchParams.get('login_hint'), 'ada@example.com');
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.subject, 'account-1');
    assert.equal(stored.accessToken, null);
  });

  it('closes the response stream when ChatGPT sends an invalid event', async () => {
    let released = false;
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith('/v1/models')) return listedModels();
      if (href.endsWith('/v1/responses')) {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {not json\n\n'));
            // Like real fetch, aborting the request ends the body.
            options.signal.addEventListener('abort', () => {
              released = true;
              controller.error(options.signal.reason);
            });
          },
        });
        return new Response(body, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async () => {});
    seedConnection(disk);
    await assert.rejects(
      () => runtime.respond([{ role: 'user', text: 'Hi', image: SHOT }]),
      /invalid event/,
    );
    assert.equal(released, true, 'the open connection was released');
  });

  it('reports a slow answer as a timeout, not as a cancellation', async () => {
    const fetchImpl = async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith('/v1/models')) return listedModels();
      if (href.endsWith('/v1/responses')) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(options.signal.reason),
          );
        });
      }
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async () => {});
    seedConnection(disk);
    await assert.rejects(
      () =>
        runtime.respond(
          [{ role: 'user', text: 'Hi', image: SHOT }],
          AbortSignal.timeout(30),
        ),
      /took too long/,
    );
    runtime.cancelRespond();
  });

  it('does not surface a token when sign-in fails', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/.well-known/openid-configuration')) {
        return Response.json({
          issuer: 'https://auth.openai.com',
          authorization_endpoint:
            'https://auth.openai.com/api/accounts/authorize',
          token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token',
          revocation_endpoint:
            'https://auth.openai.com/api/accounts/oauth/revoke',
          jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        });
      }
      if (href.endsWith('/oauth/token')) {
        return Response.json(
          {
            error: 'invalid_grant',
            error_description: 'Bearer should-not-surface',
          },
          { status: 400 },
        );
      }
      throw new Error(`unexpected ${href}`);
    };
    const { runtime, disk } = runtimeFor(fetchImpl, async (url) => {
      const auth = new URL(url);
      const redirect = new URL(auth.searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', 'test-code');
      redirect.searchParams.set('state', auth.searchParams.get('state'));
      redirect.searchParams.set('client_id', 'oaiapp_testclient');
      await fetch(redirect);
    });
    await assert.rejects(
      () => runtime.signIn({ signal: AbortSignal.timeout(5000) }),
      (error) => {
        assert.equal(error.message.includes('should-not-surface'), false);
        assert.match(error.message, /Sign in again/);
        return true;
      },
    );
    const stored = JSON.parse(disk.files.get('connection').toString());
    assert.equal(stored.clientId, 'oaiapp_testclient');
    assert.equal(stored.accessToken, null);
    assert.equal(JSON.stringify(stored).includes('test-code'), false);
    assert.equal(JSON.stringify(stored).includes('should-not-surface'), false);
  });
});
