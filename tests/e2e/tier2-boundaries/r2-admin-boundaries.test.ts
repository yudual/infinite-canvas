import { TestContext } from '../harness/test-context.js';
import { assertStatus, assertTrue } from '../harness/assertions.js';
import { AiConnectivityTestResponse, UserDto } from '../types.js';

export async function runTier2AdminBoundaryTests(ctx: TestContext): Promise<void> {
  const { client: adminClient } = await ctx.ensureAdmin();

  // Test B2.1: Duplicate username creation
  {
    const dupUsername = ctx.uniqueUsername('dup_usr');
    const firstRes = await adminClient.post('/api/admin/users', {
      username: dupUsername,
      password: 'Password123!',
      role: 'user',
    });
    assertStatus(firstRes, 201, 'First user creation should succeed with 201');

    const secondRes = await adminClient.post('/api/admin/users', {
      username: dupUsername,
      password: 'AnotherPassword456!',
      role: 'user',
    });
    assertStatus(secondRes, [409, 400], 'Duplicate user creation must return 409 Conflict or 400 Bad Request');
  }

  // Test B2.2: User creation with missing mandatory password
  {
    const missingPwRes = await adminClient.post('/api/admin/users', {
      username: ctx.uniqueUsername('no_pw'),
      role: 'user',
    });
    assertStatus(missingPwRes, 400, 'User creation without password must return 400 Bad Request');
  }

  // Test B2.3: Admin cannot delete own account
  {
    const meRes = await adminClient.get<{ user: UserDto }>('/api/auth/me');
    if (meRes.ok && meRes.data?.user?.id) {
      const selfDeleteRes = await adminClient.delete(`/api/admin/users/${meRes.data.user.id}`);
      assertStatus(selfDeleteRes, [400, 403], 'Admin attempting to delete self must return 400 Bad Request or 403 Forbidden');
    }
  }

  // Test B2.4: Admin cannot disable own account
  {
    const meRes = await adminClient.get<{ user: UserDto }>('/api/auth/me');
    if (meRes.ok && meRes.data?.user?.id) {
      const selfDisableRes = await adminClient.patch(`/api/admin/users/${meRes.data.user.id}/status`, {
        status: 'disabled',
      });
      assertStatus(selfDisableRes, [400, 403], 'Admin attempting to disable self must return 400 Bad Request or 403 Forbidden');
    }
  }

  // Test B2.5: Admin operations on non-existent user ID
  {
    const ghostId = 'non-existent-user-uuid-99999';
    const notFoundStatusRes = await adminClient.patch(`/api/admin/users/${ghostId}/status`, { status: 'disabled' });
    assertStatus(notFoundStatusRes, 404, 'Status update for non-existent user should return 404 Not Found');

    const notFoundResetRes = await adminClient.post(`/api/admin/users/${ghostId}/reset-password`, {
      newPassword: 'NewPassword123!',
    });
    assertStatus(notFoundResetRes, 404, 'Password reset for non-existent user should return 404 Not Found');

    const notFoundDeleteRes = await adminClient.delete(`/api/admin/users/${ghostId}`);
    assertStatus(notFoundDeleteRes, 404, 'Deleting non-existent user should return 404 Not Found');
  }

  // Test B2.6: AI connectivity test with invalid / unreachable URL
  {
    const testBadUrlRes = await adminClient.post<AiConnectivityTestResponse>('/api/admin/ai-config/test', {
      baseUrl: 'http://127.0.0.1:54321/unreachable',
    });
    assertStatus(testBadUrlRes, 200, 'AI connectivity test endpoint should handle unreachable target gracefully');
    assertTrue(testBadUrlRes.data.success === false, 'Connectivity test to invalid host should report success: false');
  }
}
