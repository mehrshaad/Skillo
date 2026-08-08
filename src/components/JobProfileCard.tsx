import { sendMessage } from '@/lib/messages';
import type { JobProfile } from '@/core/pipeline/types';
import { SectionHeader } from './ui';

/** The keyword lists the user can prune before tailoring runs on them. */
const EDITABLE_LISTS: { key: keyof JobProfile; label: string }[] = [
  { key: 'mustHaveSkills', label: 'Must have' },
  { key: 'niceToHaveSkills', label: 'Nice to have' },
  { key: 'toolsAndTech', label: 'Tools & tech' },
  { key: 'atsKeywords', label: 'ATS keywords' },
  { key: 'softSkills', label: 'Soft skills' },
];

export function JobProfileCard({ profile }: { profile: JobProfile }) {
  const removeFrom = (key: keyof JobProfile, value: string) => {
    const current = profile[key];
    if (!Array.isArray(current)) return;
    void sendMessage({
      type: 'state/update',
      patch: { jobProfile: { ...profile, [key]: current.filter((v) => v !== value) } },
    });
  };

  // Pay first, then what kind of contract it is: the two things that decide
  // whether the rest is worth reading. Anything the posting did not say is left
  // out entirely rather than shown as unknown.
  const details = [
    { label: 'Salary', value: profile.salary },
    { label: 'Contract', value: profile.employmentType },
    { label: 'Workplace', value: profile.workplaceType },
    { label: 'Seniority', value: profile.seniority },
    { label: 'Location', value: profile.location },
  ].filter((d) => d.value?.trim());

  return (
    <div className="space-y-4">
      {details.length > 0 && (
        <section className="space-y-1">
          <SectionHeader>The offer</SectionHeader>
          <dl className="divide-y divide-rule overflow-hidden rounded border border-rule bg-paper-sunk">
            {details.map(({ label, value }) => (
              <div key={label} className="flex items-baseline gap-3 px-2.5 py-1.5">
                <dt className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted">
                  {label}
                </dt>
                <dd
                  className={`text-xs ${
                    label === 'Salary' ? 'font-mono font-bold text-proof' : 'text-ink'
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="space-y-1.5">
        <SectionHeader>What this employer wants</SectionHeader>
        <p className="text-xs leading-relaxed text-ink">{profile.summaryForTailoring}</p>
      </section>

      {EDITABLE_LISTS.map(({ key, label }) => {
        const values = profile[key];
        if (!Array.isArray(values) || values.length === 0) return null;
        return (
          <section key={key} className="space-y-1.5">
            <SectionHeader meta={String(values.length)}>{label}</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {values.map((value) => (
                <button
                  key={value}
                  onClick={() => removeFrom(key, value)}
                  title="Remove — it will not be used when tailoring"
                  className="group rounded-sm border border-rule px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-cut hover:text-cut"
                >
                  {value}
                  <span className="ml-1 opacity-0 group-hover:opacity-100">×</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {profile.responsibilities.length > 0 && (
        <section className="space-y-1.5">
          <SectionHeader>Responsibilities</SectionHeader>
          <ul className="space-y-0.5 text-xs text-muted">
            {profile.responsibilities.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">
        Remove anything that does not apply to you. What is left guides the rewrite.
      </p>
    </div>
  );
}
