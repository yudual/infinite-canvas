import { TestContext } from '../harness/test-context.js';
import { assertEqual, assertStatus, assertTrue, assertValidJwt } from '../harness/assertions.js';
import { AuthResponse, UserDto, UserListItem } from '../types.js';

export async function runTier4UserLifecycleScenario(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();

  // Step 1: Admin creates new developer account 'dave'
  const daveUsername = ctx.uniqueUsername('dave_dev');
  const initialPassword = 'InitialDavePassword123!';

  const createRes = await adminClient.post<{ user: UserListItem }>('/api/admin/users', {
    username: daveUsername,
    password: initialPassword,
    role: 'user',
    displayName: 'Dave Developer',
  });
  assertStatus(createRes, 201, 'Step 1: Admin creates user Dave');
  const daveId = createRes.data.user.id;

  // Step 2: Dave logs in with initial credentials
  const daveClient = ctx.client.fork();
  const loginRes = await daveClient.post<AuthResponse>('/api/auth/login', {
    username: daveUsername,
    password: initialPassword,
  });
  assertStatus(loginRes, 200, 'Step 2: Dave logs in');
  assertValidJwt(loginRes.data.token);
  daveClient.setToken(loginRes.data.token);

  // Step 3: Dave fetches session profile
  const profileRes = await daveClient.get<{ user: UserDto }>('/api/auth/me');
  assertStatus(profileRes, 200, 'Step 3: Dave verifies session');
  assertEqual(profileRes.data.user.username, daveUsername);
  assertEqual(profileRes.data.user.role, 'user');

  // Step 4: Admin resets Dave's password
  const newPassword = 'DaveUpdatedSecurePass456!';
  const resetRes = await adminClient.post(`/api/admin/users/${daveId}/reset-password`, {
    newPassword,
  });
  assertStatus(resetRes, 200, "Step 4: Admin updates Dave's password");

  // Step 5: Dave logs out and logs in with new password
  await daveClient.post('/api/auth/logout');
  daveClient.setToken(null);

  const reLoginRes = await daveClient.post<AuthResponse>('/api/auth/login', {
    username: daveUsername,
    password: newPassword,
  });
  assertStatus(reLoginRes, 200, 'Step 5: Dave successfully logs in with new password');
  assertValidJwt(reLoginRes.data.token);
}
