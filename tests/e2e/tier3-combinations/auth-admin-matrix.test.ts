import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus } from '../harness/assertions.js';
import { AuthResponse } from '../types.js';

export async function runTier3AuthAdminMatrixTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();
  const testUser = await ctx.createTestUser({ role: 'user', prefix: 'matrix_usr' });
  const userClient = testUser.client;

  // Step 1: Verify user can access profile initially
  const initialMeRes = await userClient.get('/api/auth/me');
  assertStatus(initialMeRes, 200, 'Active user can access /api/auth/me');

  // Step 2: Admin disables user
  const disableRes = await adminClient.patch(`/api/admin/users/${testUser.user.id}/status`, {
    status: 'disabled',
  });
  assertStatus(disableRes, 200, 'Admin successfully disables user account');

  // Step 3: Existing active JWT token is immediately rejected on subsequent requests
  const lockedOutRes = await userClient.get('/api/auth/me');
  assertStatus(lockedOutRes, [403, 401], 'Previously active JWT must be rejected once user is disabled');

  const lockedOutProjectsRes = await userClient.get('/api/projects');
  assertStatus(lockedOutProjectsRes, [403, 401], 'Disabled user token cannot access projects endpoint');

  // Step 4: Login attempt with disabled user is rejected
  const disabledLoginRes = await ctx.client.post('/api/auth/login', {
    username: testUser.user.username,
    password: testUser.password,
  });
  assertStatus(disabledLoginRes, 403, 'Disabled user login must return 403 Forbidden');

  // Step 5: Admin re-enables user
  const enableRes = await adminClient.patch(`/api/admin/users/${testUser.user.id}/status`, {
    status: 'active',
  });
  assertStatus(enableRes, 200, 'Admin re-enables user');

  // Step 6: User logs in again successfully
  const reLoginRes = await ctx.client.post<AuthResponse>('/api/auth/login', {
    username: testUser.user.username,
    password: testUser.password,
  });
  assertStatus(reLoginRes, 200, 'Re-enabled user can log in successfully');

  // Step 7: Admin resets user password -> old password fails, new password succeeds
  const newPassword = 'NewlyResetPassword789!';
  const resetRes = await adminClient.post(`/api/admin/users/${testUser.user.id}/reset-password`, {
    newPassword,
  });
  assertStatus(resetRes, 200, 'Admin password reset succeeds');

  const oldPwLogin = await ctx.client.post('/api/auth/login', {
    username: testUser.user.username,
    password: testUser.password,
  });
  assertStatus(oldPwLogin, 401, 'Login with old password must fail after reset');

  const newPwLogin = await ctx.client.post<AuthResponse>('/api/auth/login', {
    username: testUser.user.username,
    password: newPassword,
  });
  assertStatus(newPwLogin, 200, 'Login with new reset password must succeed');
}
