'use client';

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Input';
import { FormError } from './FormError';

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

export function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    displayName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);

    try {
      await register(formData.email, formData.password, formData.displayName || undefined);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
        <Field label="Display Name (optional)">
          <Input
            id="displayName"
            name="displayName"
            type="text"
            value={formData.displayName}
            onChange={handleChange}
            disabled={loading}
            placeholder="How should we call you?"
          />
        </Field>

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

        <Field label="Password" description="Must be at least 8 characters long">
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

        <Field label="Confirm Password">
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            required
            value={formData.confirmPassword}
            onChange={handleChange}
            disabled={loading}
            placeholder="Confirm your password"
          />
        </Field>

        {error ? <FormError>{error}</FormError> : null}

        <Button
          type="submit"
          variant="primary"
          className="w-full"
          disabled={loading || !formData.email || !formData.password || !formData.confirmPassword}
        >
          {loading ? 'Creating account...' : 'Create account'}
        </Button>
      </form>

      {onSwitchToLogin && (
        <p className="text-center text-sm text-fg-muted">
          Already have an account?{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="rounded-control font-medium text-accent hover:text-accent-hover hover:underline focus-ring"
          >
            Sign in
          </button>
        </p>
      )}
    </div>
  );
}
