import { TestContext } from './harness/test-context.js';
import { Database } from 'bun:sqlite';

async function main() {
  console.log('🔥 Starting Adversarial Stress Test for Milestone 3 (AI Proxy)...');
  const ctx = new TestContext();
  await ctx.init();

  const { client: adminClient } = await ctx.ensureAdmin();
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'adv_m3_usr' });
  const userClient = userSession.client;

  let passed = 0;
  let failed = 0;

  function report(name: string, ok: boolean, details?: string) {
    if (ok) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}: ${details || 'Assertion failed'}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // Scenario 1: Unconfigured AI Service (503 AI_NOT_CONFIGURED)
  // ----------------------------------------------------
  try {
    // Clear AI config directly in SQLite DB
    const db = new Database('./data/canvas.db');
    db.run("UPDATE system_settings SET value = '' WHERE key = 'ai.api_key'");
    db.close();

    const genRes = await userClient.post('/api/ai/images/generations', { prompt: 'A test prompt' });
    report('1.1 Unconfigured image generation returns 503', genRes.status === 503 && genRes.data?.error?.code === 'AI_NOT_CONFIGURED', `status=${genRes.status}, code=${genRes.data?.error?.code}`);

    const editRes = await userClient.post('/api/ai/images/edits', { prompt: 'A test edit' });
    report('1.2 Unconfigured image edit returns 503', editRes.status === 503 && editRes.data?.error?.code === 'AI_NOT_CONFIGURED', `status=${editRes.status}, code=${editRes.data?.error?.code}`);

    const chatRes = await userClient.post('/api/ai/chat/completions', { messages: [{ role: 'user', content: 'hello' }] });
    report('1.3 Unconfigured chat completions returns 503', chatRes.status === 503 && chatRes.data?.error?.code === 'AI_NOT_CONFIGURED', `status=${chatRes.status}, code=${chatRes.data?.error?.code}`);
  } catch (err: any) {
    report('Scenario 1 Exception', false, err.message);
  }

  // Configure upstream with mock AI server
  const superSecretKey = 'sk-adv-secret-key-998877665544332211';
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: superSecretKey,
    imageModels: ['gpt-image-2', 'dall-e-3'],
    defaultModel: 'gpt-image-2',
    chatModels: ['gpt-4o', 'gpt-4o-mini'],
  });

  // ----------------------------------------------------
  // Scenario 2: Validation on Bad Inputs
  // ----------------------------------------------------
  try {
    const emptyPromptRes = await userClient.post('/api/ai/images/generations', { prompt: '   ' });
    report('2.1 Whitespace prompt rejected with 400', emptyPromptRes.status === 400 && emptyPromptRes.data?.error?.code === 'INVALID_PROMPT');

    const nullPromptRes = await userClient.post('/api/ai/images/generations', { prompt: null });
    report('2.2 Null prompt rejected with 400', nullPromptRes.status === 400 && nullPromptRes.data?.error?.code === 'INVALID_PROMPT');

    const emptyEditPromptRes = await userClient.post('/api/ai/images/edits', { prompt: '' });
    report('2.3 Empty edit prompt rejected with 400', emptyEditPromptRes.status === 400 && emptyEditPromptRes.data?.error?.code === 'INVALID_PROMPT');

    const nonArrayMessagesRes = await userClient.post('/api/ai/chat/completions', { messages: 'not an array' });
    report('2.4 Non-array messages rejected with 400', nonArrayMessagesRes.status === 400 && nonArrayMessagesRes.data?.error?.code === 'MISSING_MESSAGES');
  } catch (err: any) {
    report('Scenario 2 Exception', false, err.message);
  }

  // ----------------------------------------------------
  // Scenario 3: Leak Sanitization when Upstream Echoes Key in Error Body
  // ----------------------------------------------------
  try {
    ctx.mockAi.setNextError(401, `Authentication failed for token: ${superSecretKey}`);
    const leakAttemptRes = await userClient.post('/api/ai/images/generations', { prompt: 'Trigger error' });
    
    // Status should be mapped to 502 Bad Gateway
    const is502 = leakAttemptRes.status === 502;
    const bodyStr = JSON.stringify(leakAttemptRes.data);
    const leaked = bodyStr.includes(superSecretKey);
    const redacted = bodyStr.includes('[REDACTED]');
    report('3.1 Upstream error status mapped to 502 and key scrubbed with [REDACTED]', is502 && !leaked && redacted, `status=${leakAttemptRes.status}, body=${bodyStr}`);
  } catch (err: any) {
    report('Scenario 3 Exception', false, err.message);
  }

  // ----------------------------------------------------
  // Scenario 4: Leak Sanitization in Chat SSE Stream
  // ----------------------------------------------------
  try {
    const streamRes = await userClient.post('/api/ai/chat/completions', {
      messages: [{ role: 'user', content: 'test stream' }],
      stream: true,
    });
    const contentType = streamRes.headers.get('content-type') || '';
    report('4.1 SSE stream completes 200 OK with text/event-stream', streamRes.status === 200 && contentType.includes('text/event-stream'), `status=${streamRes.status}, ct=${contentType}`);
    report('4.2 SSE stream raw text does not contain secret key', !streamRes.rawText.includes(superSecretKey));
  } catch (err: any) {
    report('Scenario 4 Exception', false, err.message);
  }

  // ----------------------------------------------------
  // Scenario 5: Multipart Form-Data Image Edits
  // ----------------------------------------------------
  try {
    ctx.mockAi.clearRequests();
    // Test multipart upload with form-data
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const formBody = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="prompt"',
      '',
      'Inpaint glowing stars',
      `--${boundary}`,
      'Content-Disposition: form-data; name="image"; filename="canvas.png"',
      'Content-Type: image/png',
      '',
      'FAKE_PNG_BINARY_CONTENT',
      `--${boundary}--`,
    ].join('\r\n');

    const rawRes = await fetch(`${ctx.baseUrl}/api/ai/images/edits`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        Authorization: `Bearer ${userSession.token}`,
      },
      body: formBody,
    });

    const editData: any = await rawRes.json();
    report('5.1 Multipart image edit forwarded successfully (200 OK)', rawRes.status === 200 && Array.isArray(editData.data));
    const lastUpstream = ctx.mockAi.getLastRequest();
    report('5.2 Upstream mock received multipart image edit with Bearer auth', lastUpstream?.path?.includes('/images/edits') && (lastUpstream?.headers['authorization'] as string)?.includes(superSecretKey));
  } catch (err: any) {
    report('Scenario 5 Exception', false, err.message);
  }

  // ----------------------------------------------------
  // Scenario 6: AbortController Streaming Abort Handling
  // ----------------------------------------------------
  try {
    const controller = new AbortController();
    const abortPromise = fetch(`${ctx.baseUrl}/api/ai/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSession.token}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Long running response' }],
        stream: true,
      }),
      signal: controller.signal,
    });

    // Abort after 20ms to simulate client disconnecting mid-stream
    setTimeout(() => controller.abort(), 20);

    try {
      await abortPromise;
    } catch (abortErr: any) {
      // Expected client fetch abort
    }

    // Server should handle this without crashing. Check server health immediately after:
    const healthRes = await fetch(`${ctx.baseUrl}/api/health`);
    report('6.1 Server healthy and responsive after client SSE abort', healthRes.status === 200);
  } catch (err: any) {
    report('Scenario 6 Exception', false, err.message);
  }

  // ----------------------------------------------------
  // Scenario 7: Disabled User Forbidden across all AI Proxy endpoints
  // ----------------------------------------------------
  try {
    // Disable userSession account via admin API
    await adminClient.patch(`/api/admin/users/${userSession.user.id}/status`, { status: 'disabled' });

    const blockedGen = await userClient.post('/api/ai/images/generations', { prompt: 'Blocked prompt' });
    report('7.1 Disabled user blocked from /api/ai/images/generations (403)', blockedGen.status === 403);

    const blockedEdit = await userClient.post('/api/ai/images/edits', { prompt: 'Blocked prompt' });
    report('7.2 Disabled user blocked from /api/ai/images/edits (403)', blockedEdit.status === 403);

    const blockedChat = await userClient.post('/api/ai/chat/completions', { messages: [{ role: 'user', content: 'hi' }] });
    report('7.3 Disabled user blocked from /api/ai/chat/completions (403)', blockedChat.status === 403);

    const blockedModels = await userClient.get('/api/ai/models');
    report('7.4 Disabled user blocked from /api/ai/models (403)', blockedModels.status === 403);
  } catch (err: any) {
    report('Scenario 7 Exception', false, err.message);
  }

  await ctx.teardown();

  console.log(`\n======================================================`);
  console.log(`Adversarial Tests Complete: Passed: ${passed}, Failed: ${failed}`);
  console.log(`======================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal in adversarial test:', err);
  process.exit(1);
});
