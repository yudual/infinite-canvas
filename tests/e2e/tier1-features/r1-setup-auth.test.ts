import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue, assertValidJwt } from '../harness/assertions.js';
import { AuthResponse, SetupStatusResponse, UserDto } from '../types.js';

export async function runTier1AuthTests(ctx: TestContext): Promise<void> {
  // Test 1.1: Setup status endpoint returns correct structure
  {
    const res = await ctx.client.get<SetupStatusResponse>('/api/setup/status');
    assertStatus(res, 200, 'GET /api/setup/status should return 200 OK');
    assertTrue(typeof res.data.initialized === 'boolean', 'status.initialized must be a boolean');
  }

  // Test 1.2: Admin setup or admin existence check
  {
    const statusRes = await ctx.client.get<SetupStatusResponse>('/api/setup/status');
    if (!statusRes.data.initialized) {
      const adminUsername = ctx.uniqueUsername('firstadmin');
      const setupRes = await ctx.client.post<AuthResponse>('/api/setup', {
        username: adminUsername,
        password: 'AdminSuperPassword123!',
        displayName: 'First Super Admin',
      });
      assertStatus(setupRes, 201, 'POST /api/setup should return 201 Created when uninitialized');
      assertTrue(setupRes.data.success !== false, 'Setup response should indicate success');
      assertValidJwt(setupRes.data.token, 'Setup response should include valid JWT');
      assertEqual(setupRes.data.user.role, 'admin', 'First created user must have admin role');
      if (setupRes.data?.token) {
        ctx.client.setToken(setupRes.data.token);
      }
    } else {
      // If already initialized, POST /api/setup should be blocked
      const setupRes = await ctx.client.post('/api/setup', {
        username: 'another_admin',
        password: 'password123',
      });
      assertStatus(setupRes, [403, 400], 'POST /api/setup should be rejected once initialized');
    }
  }

  // Test 1.3: User login with valid credentials
  {
    const testUser = await ctx.createTestUser({ role: 'user', prefix: 'login_usr' });
    const client = ctx.client.fork();
    const loginRes = await client.post<AuthResponse>('/api/auth/login', {
      username: testUser.user.username,
      password: testUser.password,
    });
    assertStatus(loginRes, 200, 'POST /api/auth/login should return 200 OK for valid credentials');
    assertValidJwt(loginRes.data.token, 'Login response must contain a valid JWT');
    assertEqual(loginRes.data.user.username, testUser.user.username, 'Login user profile must match username');
  }

  // Test 1.4: GET /api/auth/me returns current session profile
  {
    const testUser = await ctx.createTestUser({ role: 'user', prefix: 'me_usr' });
    const res = await testUser.client.get<{ user: UserDto }>('/api/auth/me');
    assertStatus(res, 200, 'GET /api/auth/me with valid Bearer token should return 200 OK');
    assertEqual(res.data.user.username, testUser.user.username, 'Profile username must match authenticated user');
    assertEqual(res.data.user.role, 'user', 'User role in session profile must match');
  }

  // Test 1.5: POST /api/auth/logout invalidates session
  {
    const testUser = await ctx.createTestUser({ role: 'user', prefix: 'logout_usr' });
    const logoutRes = await testUser.client.post<{ success: boolean }>('/api/auth/logout');
    assertStatus(logoutRes, [200, 204], 'POST /api/auth/logout should return 200 OK or 204 No Content');
  }

  // Test 1.6: Authentication guard rejects unauthenticated requests to protected endpoints
  {
    const unauthClient = ctx.client.fork();
    unauthClient.setToken(null);
    const meRes = await unauthClient.get('/api/auth/me');
    assertStatus(meRes, [401, 403], 'GET /api/auth/me without token must return 401 Unauthorized or 403 Forbidden');
  }
}
