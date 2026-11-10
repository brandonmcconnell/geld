import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from '@/components/icons';
import { Brand } from './brand';
import { PrivacySettingsButton } from './privacy-settings-button';

export function AuthFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="auth-layout">
      <div className="auth-main">
        <header className="auth-header">
          <Link href="https://www.geld.sh" aria-label="Geld home">
            <Brand />
          </Link>
          <Link href="https://www.geld.sh" className="auth-back">
            <ArrowLeft size={14} /> Back to website
          </Link>
        </header>
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <ShieldCheck size={14} /> Your code stays yours. <Link href="https://www.geld.sh/privacy">Privacy policy</Link>
          <PrivacySettingsButton />
        </footer>
      </div>
      <aside className="auth-story" aria-label="Review with clarity">
        <span className="auth-story-label">LESS NOISE. MORE UNDERSTANDING.</span>
        <h2>
          See the change.
          <br />
          Find your flow.
        </h2>
        <p>A calmer place to review code. Bring your repositories together and follow the story, one step at a time.</p>
        <ol className="auth-principles" role="list">
          <li>
            <span>01</span>
            <div>
              <strong>Know what needs your review</strong>
              <p>One queue across GitHub, GitLab and Bitbucket.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Understand the whole change</strong>
              <p>Guided reviews connect the story across files.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Pick up where you left off</strong>
              <p>Your review progress stays with you.</p>
            </div>
          </li>
        </ol>
      </aside>
    </div>
  );
}
