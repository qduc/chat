'use client';

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Input';
import { FormError } from './FormError';

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(formData.email, formData.password);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input
            id="email"
            name="email"
            type="email"
            required
            value={formData.email}
            onChange={handleChange}
            disabled={loading}
            placeholder="Enter your email"
          />
        </Field>

        <Field label="Password">
          <Input
            id="password"
            name="password"
            type="password"
            required
            value={formData.password}
            onChange={handleChange}
            disabled={loading}
            placeholder="Enter your password"
          />
        </Field>

        {error ? <FormError>{error}</FormError> : null}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={loading || !formData.email || !formData.password}
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>

      {onSwitchToRegister && (
        <p className="text-center text-sm text-fg-muted">
          Don&apos;t have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="rounded-control font-medium text-accent hover:text-accent-hover hover:underline focus-ring"
          >
            Create account
          </button>
        </p>
      )}
    </div>
  );
}
