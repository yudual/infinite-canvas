export interface UserDto {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserListItem {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
  success?: boolean;
}

export interface SetupStatusResponse {
  initialized: boolean;
  requiresSetup?: boolean;
  allowSetup?: boolean;
}

export interface AiConfigDto {
  baseUrl: string;
  apiKeyMasked?: string;
  hasKey?: boolean;
  hasApiKey?: boolean;
  imageModels: string[];
  defaultModel: string;
  chatModels?: string[];
}

export interface AiConnectivityTestResponse {
  success: boolean;
  latencyMs?: number;
  message?: string;
}

export interface SystemStatsDto {
  userCount: number;
  activeUserCount?: number;
  projectCount: number;
  assetCount: number;
  storageBytes: number;
}

export interface ProjectSummaryDto {
  id: string;
  name?: string;
  title?: string;
  thumbnail?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectDetailDto {
  id: string;
  userId?: string;
  user_id?: string;
  name?: string;
  title?: string;
  canvasData?: Record<string, any>;
  canvas_data?: string | Record<string, any>;
  thumbnail?: string;
  createdAt?: string;
  updatedAt?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AssetDto {
  id: string;
  url: string;
  filename: string;
  mimeType?: string;
  mime_type?: string;
  sizeBytes?: number;
  size_bytes?: number;
  createdAt?: string;
  created_at?: string;
}

export interface ImageGenerationResponse {
  created?: number;
  data: Array<{
    url?: string;
    b64_json?: string;
    revised_prompt?: string;
  }>;
}

export interface ErrorResponseDto {
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  message?: string;
}

export interface ApiResponse<T = any> {
  status: number;
  ok: boolean;
  headers: Headers;
  data: T;
  rawText: string;
}
