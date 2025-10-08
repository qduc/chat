// Minimal shim for auth API so tests can mock the module path `../lib/auth/api`
// Tests usually replace this with jest.mock so the implementation here can be simple.

export interface User {
  id: string;
  email: string;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoginResponse {
  tokens: { accessToken: string; refreshToken: string };
  user: User;
}

export interface RegisterResponse extends LoginResponse {}

export const authApi = {
  async register(_email: string, _password: string, _displayName?: string) {
    throw new Error('Not implemented');
  },
  async login(_email: string, _password: string) {
    throw new Error('Not implemented');
  },
  async logout() {
    return;
  },
  async refreshToken() {
    throw new Error('Not implemented');
  },
  async getProfile() {
    throw new Error('Not implemented');
  }
};
