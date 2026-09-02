import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue } from '../harness/assertions.js';
import { AiConnectivityTestResponse, SystemStatsDto, UserListItem } from '../types.js';

export async function runTier4AdminOpsScenario(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();

  // Step 1: Initial System Stats
  const initialStatsRes = await adminClient.get<SystemStatsDto>('/api/admin/stats');
  assertStatus(initialStatsRes, 200, 'Step 1: Admin reads initial system stats');
  const initialUserCount = initialStatsRes.data.userCount || 0;

  // Step 2: Admin creates 2 users
  const user1Name = ctx.uniqueUsername('ops_u1');
  const user2Name = ctx.uniqueUsername('ops_u2');

  const u1Res = await adminClient.post<{ user: UserListItem }>('/api/admin/users', {
    username: user1Name,
    password: 'Password123!',
    role: 'user',
  });
  assertStatus(u1Res, 201, 'Step 2a: Admin creates User 1');

  const u2Res = await adminClient.post<{ user: UserListItem }>('/api/admin/users', {
    username: user2Name,
    password: 'Password123!',
    role: 'user',
  });
  assertStatus(u2Res, 201, 'Step 2b: Admin creates User 2');

  // Step 3: Admin executes AI connectivity probe
  const probeRes = await adminClient.post<AiConnectivityTestResponse>('/api/admin/ai-config/test', {
    baseUrl: ctx.mockAi.getUrl(),
  });
  assertStatus(probeRes, 200, 'Step 3: Admin runs AI connectivity test');
  assertTrue(probeRes.data.success === true, 'Connectivity probe to Mock AI server must succeed');

  // Step 4: Admin disables User 2
  const disableRes = await adminClient.patch(`/api/admin/users/${u2Res.data.user.id}/status`, {
    status: 'disabled',
  });
  assertStatus(disableRes, 200, 'Step 4: Admin disables User 2');

  // Step 5: Admin re-checks stats
  const updatedStatsRes = await adminClient.get<SystemStatsDto>('/api/admin/stats');
  assertStatus(updatedStatsRes, 200, 'Step 5: Admin reads updated stats');
  assertTrue(
    updatedStatsRes.data.userCount >= initialUserCount + 2,
    'Total users count must have increased by at least 2'
  );
}
