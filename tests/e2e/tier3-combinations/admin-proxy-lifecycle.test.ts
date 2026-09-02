import { TestContext } from '../harness/test-context.js';
import { assertNoKeyLeak, assertStatus, assertTrue } from '../harness/assertions.js';

export async function runTier3AdminProxyLifecycleTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const userSession = await ctx.createTestUser({ role: 'user', prefix: 'proxy_cycle_usr' });

  // Phase 1: Set Upstream Config #1
  const keyV1 = 'sk-stage1-dynamic-key-AAAA';
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: keyV1,
    imageModels: ['gpt-image-2'],
    defaultModel: 'gpt-image-2',
  });

  ctx.mockAi.clearRequests();
  const res1 = await userSession.client.post('/api/ai/images/generations', {
    prompt: 'Phase 1 Prompt',
    model: 'gpt-image-2',
  });
  assertStatus(res1, 200, 'Generation under config v1 must succeed');

  const auth1 = ctx.mockAi.getLastAuthHeader();
  assertTrue(!!auth1 && auth1.includes(keyV1), 'Upstream received key V1 on phase 1');
  assertNoKeyLeak(res1.data, keyV1);

  // Phase 2: Dynamically update AI config to Key #2 without restarting backend
  const keyV2 = 'sk-stage2-updated-key-BBBB';
  await adminClient.put('/api/admin/ai-config', {
    baseUrl: ctx.mockAi.getUrl(),
    apiKey: keyV2,
    imageModels: ['gpt-image-2', 'dall-e-3'],
    defaultModel: 'dall-e-3',
  });

  ctx.mockAi.clearRequests();
  const res2 = await userSession.client.post('/api/ai/images/generations', {
    prompt: 'Phase 2 Prompt',
    model: 'dall-e-3',
  });
  assertStatus(res2, 200, 'Generation under config v2 must succeed');

  const auth2 = ctx.mockAi.getLastAuthHeader();
  assertTrue(!!auth2 && auth2.includes(keyV2), 'Upstream received updated key V2 on phase 2');
  assertNoKeyLeak(res2.data, keyV2);
}
