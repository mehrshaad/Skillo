import { useEffect, useState } from 'react';
import { EMPTY_PROFILE, IMPORT_PROMPTS, isProfileEmpty, type UserProfile } from '@/core/profile';
import { getProfile, saveProfile } from '@/lib/profileStore';
import { Button, Collapsible, Note, SectionHeader, SwapText, TextArea } from './ui';

const FIELDS: { key: keyof UserProfile; label: string; hint: string; placeholder: string }[] = [
  {
    key: 'summary',
    label: 'Who you are',
    hint: 'Where you are in your career and what you want next. This is what steers emphasis.',
    placeholder:
      'Backend engineer, four years, mostly Python and Postgres. Want to move toward platform work and away from client projects.',
  },
  {
    key: 'evidence',
    label: 'What your resume undersells',
    hint: 'Numbers and results that are missing or buried. Skillo can only use what it is told.',
    placeholder:
      'The 20% load-time win was mine end to end. I ran the Postgres migration for 40 services, which the CV only calls "database work".',
  },
  {
    key: 'constraints',
    label: 'Things a resume cannot show',
    hint: 'Visa status, notice period, relocation, the floor on salary. Used to judge fit, never printed.',
    placeholder: 'EU citizen, no sponsorship needed. Two months notice. Happy to relocate to Amsterdam or Berlin.',
  },
  {
    key: 'preferences',
    label: 'How you want to be written about',
    hint: 'Tone, words to avoid, British or American spelling.',
    placeholder: 'British spelling. Do not call me a specialist. Never use the word "passionate".',
  },
];

function ImportPrompts() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        If you already talk to ChatGPT, Claude or Gemini, they know a lot of this. Copy a prompt,
        run it there, and paste the answer into the box below.
      </p>
      {IMPORT_PROMPTS.map(({ id, label, prompt }) => (
        <div key={id} className="space-y-1">
          <Button variant="secondary" onClick={() => copy(id, prompt)}>
            <SwapText>{copied === id ? 'Copied' : `Copy prompt — ${label}`}</SwapText>
          </Button>
        </div>
      ))}
      <Note>
        Each prompt tells the assistant to write "not recorded" rather than guess. Keep that line:
        anything it invents would end up in a real application.
      </Note>
    </div>
  );
}

export function Profile({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  if (!profile) return <p className="text-xs text-muted">Loading…</p>;

  const edit = (key: keyof UserProfile, value: string) => {
    setProfile({ ...profile, [key]: value });
    setSaved(false);
  };

  const persist = async () => {
    const next = await saveProfile(profile);
    setProfile(next);
    setSaved(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <SectionHeader>About you</SectionHeader>
        <Button variant="ghost" onClick={onClose}>
          done
        </Button>
      </div>

      <p className="text-xs text-muted">
        Written once, used by every run. Skillo writes a better resume when it knows what you are
        aiming at than when it only has the file. This never leaves your machine — unlike your
        settings, it is not synced.
      </p>

      <Collapsible
        title="Import it from another assistant"
        open={importOpen}
        onToggle={setImportOpen}
        hint="2 min"
      >
        <ImportPrompts />
      </Collapsible>

      {FIELDS.map(({ key, label, hint, placeholder }) => (
        <section key={key} className="space-y-1.5">
          <SectionHeader>{label}</SectionHeader>
          <p className="text-xs text-muted">{hint}</p>
          <TextArea
            rows={3}
            value={profile[key] as string}
            onChange={(e) => edit(key, e.target.value)}
            placeholder={placeholder}
            aria-label={label}
          />
        </section>
      ))}

      <section className="space-y-1.5">
        <SectionHeader meta="pasted, kept verbatim">From another assistant</SectionHeader>
        <TextArea
          rows={5}
          value={profile.imported}
          onChange={(e) => edit('imported', e.target.value)}
          placeholder="Paste what ChatGPT or Claude wrote back about you."
          aria-label="Imported notes"
        />
      </section>

      <div className="flex items-center gap-3 border-t border-rule pt-3">
        <Button onClick={() => void persist()}>
          <SwapText>{saved ? 'Saved' : 'Save'}</SwapText>
        </Button>
        {isProfileEmpty(profile) ? (
          <span className="text-xs text-muted">Nothing here yet — runs use only your resume.</span>
        ) : (
          <button
            className="font-mono text-[10px] text-muted underline hover:text-cut"
            onClick={() => {
              setProfile({ ...EMPTY_PROFILE });
              setSaved(false);
            }}
          >
            clear
          </button>
        )}
      </div>
    </div>
  );
}
