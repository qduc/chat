import { ChatV2 } from '@/components/ChatV2';
import { ProtectedRoute, AuthGate } from '@/components/auth';

export default function Home() {
  return (
    <ProtectedRoute requireAuth fallback={<AuthGate />}>
      <div className="min-h-dvh">
        <ChatV2 />
      </div>
    </ProtectedRoute>
  );
}
