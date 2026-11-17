import React from 'react';
import { CircleAlert } from 'lucide-react';

/** Form-level error callout, announced to assistive tech. */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-control bg-danger-subtle px-3 py-2 text-sm text-danger"
    >
      <span aria-hidden="true" className="flex h-5 items-center">
        <CircleAlert className="size-4" />
      </span>
      <p>{children}</p>
    </div>
  );
}
