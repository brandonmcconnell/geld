import { PRIVACY_SECTIONS, PRIVACY_UPDATED } from '@geld/domain/privacy';
export default function PrivacyPage() {
  return (
    <div className="page max-w-3xl">
      <p className="eyebrow">PRIVACY</p>
      <h1>Your work deserves clear boundaries.</h1>
      <p className="muted mt-3">Last updated {PRIVACY_UPDATED}</p>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.id} className="mt-8">
          <h2 className="text-lg font-medium" id={section.id}>
            {section.title}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="muted mt-3 leading-7">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
