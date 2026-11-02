import { Suspense } from 'react';
import { PasswordReset } from '@/components/password-reset';
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p>Loading password setup...</p>}>
      <PasswordReset />
    </Suspense>
  );
}
