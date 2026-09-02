import { TestContext } from '../harness/test-context.js';
import { assertContains, assertEqual, assertNoKeyLeak, assertStatus, assertTrue } from '../harness/assertions.js';
import { ImageGenerationResponse } from '../types.js';

export async function runTier1ProxyTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const secretKey = 'sk-upstream-secret-ai-token-11223344';

  // Ensure AI config points to Mock AI upstream
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: secretKey,
    imageModels: ['gpt-image-2', 'dall-e-3'],
    defaultModel: 'gpt-image-2',
    chatModels: ['gpt-4o'],
  });

  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'ai_proxy_usr' });

  // Test 3.1: GET /api/ai/models returns available models
  {
    const modelsRes = await userSession.client.get<{ imageModels: string[]; defaultImageModel?: string; defaultModel?: string }>('/api/ai/models');
    assertStatus(modelsRes, 200, 'GET /api/ai/models should return 200 OK');
    assertTrue(Array.isArray(modelsRes.data.imageModels), 'Models response should include imageModels array');
    assertNoKeyLeak(modelsRes.data, secretKey);
  }

  // Test 3.2: POST /api/ai/images/generations forwards request and attaches server key
  {
    ctx.mockAi.clearRequests();
    const prompt = 'A futuristic cybernetic canvas with glowing neon nodes';

    const genRes = await userSession.client.post<ImageGenerationResponse>('/api/ai/images/generations', {
      prompt,
      model: 'gpt-image-2',
      size: '1024x1024',
      n: 1,
    });

    assertStatus(genRes, 200, 'POST /api/ai/images/generations should return 200 OK');
    assertTrue(Array.isArray(genRes.data.data) && genRes.data.data.length > 0, 'Generation response must contain image data array');
    assertTrue(!!(genRes.data.data[0].url || genRes.data.data[0].b64_json), 'Generated item must have url or b64_json');

    // Verify upstream request received authorization header injected by backend
    const lastReq = ctx.mockAi.getLastRequest();
    assertTrue(!!lastReq, 'Mock AI server must have received forwarded request');
    const authHeader = ctx.mockAi.getLastAuthHeader();
    assertTrue(!!authHeader && authHeader.includes(secretKey), 'Upstream mock server must receive server-injected secret key');

    // Verify response body does not leak secret key
    assertNoKeyLeak(genRes.data, secretKey);
  }

  // Test 3.3: POST /api/ai/images/edits forwards inpainting/editing request
  {
    ctx.mockAi.clearRequests();
    const editRes = await userSession.client.post('/api/ai/images/edits', {
      prompt: 'Add a red rose to the canvas center',
      image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    assertStatus(editRes, [200, 201], 'POST /api/ai/images/edits should return 200 OK');
    assertNoKeyLeak(editRes.data, secretKey);
  }

  // Test 3.4: POST /api/ai/chat/completions (Standard JSON)
  {
    ctx.mockAi.clearRequests();
    const chatRes = await userSession.client.post('/api/ai/chat/completions', {
      messages: [{ role: 'user', content: 'Generate canvas ideas' }],
      model: 'gpt-4o',
      stream: false,
    });
    assertStatus(chatRes, 200, 'POST /api/ai/chat/completions should return 200 OK');
    assertNoKeyLeak(chatRes.data, secretKey);
  }

  // Test 3.5: POST /api/ai/chat/completions (SSE Stream)
  {
    ctx.mockAi.clearRequests();
    const streamRes = await userSession.client.post('/api/ai/chat/completions', {
      messages: [{ role: 'user', content: 'Streaming test' }],
      model: 'gpt-4o',
      stream: true,
    });
    assertStatus(streamRes, 200, 'POST /api/ai/chat/completions with stream=true should return 200 OK');
    assertNoKeyLeak(streamRes.rawText, secretKey);
  }

  // Test 3.6: Unauthenticated user is blocked from AI proxy
  {
    const unauthClient = ctx.client.fork();
    unauthClient.setToken(null);
    const blockedRes = await unauthClient.post('/api/ai/images/generations', {
      prompt: 'Blocked prompt',
    });
    assertStatus(blockedRes, [401, 403], 'Unauthenticated call to /api/ai/* must return 401 Unauthorized');
  }
}
