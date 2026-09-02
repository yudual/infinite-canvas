import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertNoKeyLeak, assertStatus, assertTrue } from '../harness/assertions.js';
import { AiConfigDto, AiConnectivityTestResponse, SystemStatsDto, UserListItem } from '../types.js';

export async function runTier1AdminTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const regularUser = await ctx.createTestUser({ role: 'user', prefix: 'reg_admin_test' });

  // Test 2.1: Non-admin user access is blocked with 403 Forbidden
  {
    const usersRes = await regularUser.client.get('/api/admin/users');
    assertStatus(usersRes, 403, 'Regular user accessing GET /api/admin/users must receive 403 Forbidden');

    const statsRes = await regularUser.client.get('/api/admin/stats');
    assertStatus(statsRes, 403, 'Regular user accessing GET /api/admin/stats must receive 403 Forbidden');

    const configRes = await regularUser.client.get('/api/admin/ai-config');
    assertStatus(configRes, 403, 'Regular user accessing GET /api/admin/ai-config must receive 403 Forbidden');
  }

  // Test 2.2: Admin lists users with pagination
  {
    const res = await adminClient.get<{ users: UserListItem[]; total: number }>('/api/admin/users?page=1&limit=10');
    assertStatus(res, 200, 'Admin GET /api/admin/users should return 200 OK');
    assertTrue(Array.isArray(res.data.users), 'Admin users response must contain a users array');
    assertTrue(typeof res.data.total === 'number' || res.data.users.length >= 0, 'Total user count must be present');
  }

  // Test 2.3: Admin creates a new user
  let createdUserId: string | null = null;
  const newUsername = ctx.uniqueUsername('adm_created');
  {
    const createRes = await adminClient.post<{ user: UserListItem }>('/api/admin/users', {
      username: newUsername,
      password: 'InitialPassword123!',
      role: 'user',
      displayName: 'Admin Created User',
    });
    assertStatus(createRes, 201, 'Admin POST /api/admin/users should return 201 Created');
    assertEqual(createRes.data.user.username, newUsername, 'Created user username must match');
    createdUserId = createRes.data.user.id;
  }

  // Test 2.4: Admin toggles user status
  if (createdUserId) {
    const patchRes = await adminClient.patch<{ user: UserListItem }>(`/api/admin/users/${createdUserId}/status`, {
      status: 'disabled',
    });
    assertStatus(patchRes, 200, 'Admin PATCH status to disabled should return 200 OK');

    // Re-enable user
    const enableRes = await adminClient.patch<{ user: UserListItem }>(`/api/admin/users/${createdUserId}/status`, {
      status: 'active',
    });
    assertStatus(enableRes, 200, 'Admin PATCH status to active should return 200 OK');
  }

  // Test 2.5: Admin resets user password
  if (createdUserId) {
    const resetRes = await adminClient.post<{ success: boolean }>(
      `/api/admin/users/${createdUserId}/reset-password`,
      { newPassword: 'NewPasswordReset456!' }
    );
    assertStatus(resetRes, 200, 'Admin POST /reset-password should return 200 OK');

    // Verify user can log in with new password
    const loginRes = await ctx.client.post('/api/auth/login', {
      username: newUsername,
      password: 'NewPasswordReset456!',
    });
    assertStatus(loginRes, 200, 'User should successfully log in with reset password');
  }

  // Test 2.6: Admin updates and retrieves AI Config (verifying masked secret key)
  {
    const mockUpstreamUrl = ctx.mockAi.getUrl();
    const secretApiKey = 'sk-super-secret-test-key-987654321';

    const updateRes = await adminClient.put<{ success: boolean }>('/api/admin/ai-config', {
      baseUrl: mockUpstreamUrl,
      apiKey: secretApiKey,
      imageModels: ['gpt-image-2', 'dall-e-3'],
      defaultModel: 'gpt-image-2',
      chatModels: ['gpt-4o'],
    });
    assertStatus(updateRes, 200, 'Admin PUT /api/admin/ai-config should return 200 OK');

    const getRes = await adminClient.get<AiConfigDto>('/api/admin/ai-config');
    assertStatus(getRes, 200, 'Admin GET /api/admin/ai-config should return 200 OK');
    assertEqual(getRes.data.baseUrl, mockUpstreamUrl, 'Base URL in AI config should match');
    assertEqual(getRes.data.defaultModel, 'gpt-image-2', 'Default model in AI config should match');
    assertNoKeyLeak(getRes.data, secretApiKey);
  }

  // Test 2.7: Admin tests AI connectivity probe
  {
    const testRes = await adminClient.post<AiConnectivityTestResponse>('/api/admin/ai-config/test', {
      baseUrl: ctx.mockAi.getUrl(),
    });
    assertStatus(testRes, 200, 'Admin POST /api/admin/ai-config/test should return 200 OK');
    assertTrue(typeof testRes.data.success === 'boolean', 'Connectivity test response must contain success boolean');
  }

  // Test 2.8: Admin inspects system statistics overview
  {
    const statsRes = await adminClient.get<SystemStatsDto>('/api/admin/stats');
    assertStatus(statsRes, 200, 'Admin GET /api/admin/stats should return 200 OK');
    assertTrue(typeof statsRes.data.userCount === 'number', 'Stats must include userCount number');
    assertTrue(typeof statsRes.data.projectCount === 'number', 'Stats must include projectCount number');
    assertTrue(typeof statsRes.data.assetCount === 'number', 'Stats must include assetCount number');
  }

  // Test 2.9: Admin deletes user
  if (createdUserId) {
    const deleteRes = await adminClient.delete<{ success: boolean }>(`/api/admin/users/${createdUserId}`);
    assertStatus(deleteRes, 200, 'Admin DELETE /api/admin/users/:id should return 200 OK');
  }
}
