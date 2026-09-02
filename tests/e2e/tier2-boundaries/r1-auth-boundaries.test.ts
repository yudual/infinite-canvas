import { TestContext } from '../harness/test-context.js';
import { assertStatus } from '../harness/assertions.js';

export async function runTier2AuthBoundaryTests(ctx: TestContext): Promise<void> {
  // Test B1.1: Login with empty payload
  {
    const emptyRes = await ctx.client.post('/api/auth/login', {});
    assertStatus(emptyRes, [400, 401], 'Login with empty body should return 400 Bad Request or 401');
  }

  // Test B1.2: Login with whitespace-only username
  {
    const wsRes = await ctx.client.post('/api/auth/login', {
      username: '   ',
      password: 'password123',
    });
    assertStatus(wsRes, [400, 401], 'Login with whitespace username should return 400 or 401');
  }

  // Test B1.3: Login with incorrect password
  {
    const testUser = await ctx.createTestUser({ role: 'user', prefix: 'wrong_pw' });
    const badPwRes = await ctx.client.post('/api/auth/login', {
      username: testUser.user.username,
      password: 'WrongPassword999!',
    });
    assertStatus(badPwRes, 401, 'Login with wrong password must return 401 Unauthorized');
  }

  // Test B1.4: Login with non-existent username
  {
    const ghostRes = await ctx.client.post('/api/auth/login', {
      username: 'non_existent_ghost_user_99999',
      password: 'Password123!',
    });
    assertStatus(ghostRes, 401, 'Login with non-existent user must return 401 Unauthorized');
  }

  // Test B1.5: Login with disabled user returns 403 Forbidden
  {
    const disabledUser = await ctx.createTestUser({ role: 'user', status: 'disabled', prefix: 'dis_user' });
    const disabledLoginRes = await ctx.client.post('/api/auth/login', {
      username: disabledUser.user.username,
      password: disabledUser.password,
    });
    assertStatus(disabledLoginRes, 403, 'Login with disabled account must return 403 Forbidden');
  }

  // Test B1.6: Authenticated endpoint with malformed/tampered JWT
  {
    const tamperedClient = ctx.client.fork();
    tamperedClient.setToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tamperedpayload.invalidsignature');
    const meRes = await tamperedClient.get('/api/auth/me');
    assertStatus(meRes, [401, 403], 'Request with forged/tampered JWT must return 401 Unauthorized');
  }

  // Test B1.7: Calling POST /api/setup repeatedly when already initialized
  {
    const setupRes = await ctx.client.post('/api/setup', {
      username: 'duplicate_admin',
      password: 'SuperAdminPassword123!',
    });
    assertStatus(setupRes, [403, 400], 'POST /api/setup when already initialized must return 403 Forbidden');
  }
}
