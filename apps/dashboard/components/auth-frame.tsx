import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';

export function AuthFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="auth-layout">
      <div className="auth-main">
        <header className="auth-header">
          <Link href="/" aria-label="Geld home">
            <Brand />
          </Link>
          <Link href="/" className="auth-back">
            <ArrowLeft size={14} /> Back to workspace
          </Link>
        </header>
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <ShieldCheck size={14} /> Your code stays yours. <Link href="/privacy">Privacy policy</Link>
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
              <strong>Bring the work into focus</strong>
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
              <strong>Keep moving with confidence</strong>
              <p>Less noise. Clear decisions. Your progress, preserved.</p>
            </div>
          </li>
        </ol>
        <div className="auth-story-footer">
          <span>GitHub · GitLab · Bitbucket</span>
          <span>One clear workspace.</span>
        </div>
      </aside>
    </div>
  );
}
