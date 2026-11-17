'use client';
export function PrivacySettingsButton() {
  return (
    <button
      type="button"
      className="auth-privacy-choice"
      onClick={() => window.dispatchEvent(new Event('geld:privacy'))}
    >
      Privacy choices
    </button>
  );
}
