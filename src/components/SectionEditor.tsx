import { useEffect, useRef, useState } from 'react';
import {
  assembleSections,
  newSection,
  parseSections,
  replaceSectionBody,
  retitleSection,
  sectionBody,
  type ResumeSection,
  type SectionedResume,
} from '@/core/latexSections';
import { Button, SectionHeader, TextArea, TextInput } from './ui';

/**
 * Reorder, rename, edit, add and remove the resume's sections before tailoring.
 *
 * Every operation reassembles the whole document, so what the model receives is
 * always exactly what this editor shows. If the template cannot be sliced
 * safely the parser returns null and this renders nothing at all — failing
 * closed is cheap, mangling someone's resume is not.
 */
export function SectionEditor({
  latex,
  onChange,
}: {
  latex: string;
  onChange: (latex: string) => void;
}) {
  const [doc, setDoc] = useState<SectionedResume | null>(() => parseSections(latex));
  // Open by default: this is something to act on before generating, not a
  // detail to go looking for.
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ section: ResumeSection; index: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const lastWritten = useRef<string | null>(null);
  const asLoaded = useRef(latex);

  // Re-parse only when the document changed underneath us, not when our own
  // write comes back round through state.
  useEffect(() => {
    if (latex === lastWritten.current) return;
    setDoc(parseSections(latex));
    asLoaded.current = latex;
  }, [latex]);

  if (!doc) return null;

  const commit = (sections: ResumeSection[]) => {
    const next = { ...doc, sections };
    setDoc(next);
    const assembled = assembleSections(next);
    lastWritten.current = assembled;
    onChange(assembled);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= doc.sections.length || from === to) return;
    const sections = [...doc.sections];
    const [moved] = sections.splice(from, 1);
    sections.splice(to, 0, moved!);
    commit(sections);
  };

  const remove = (index: number) => {
    setRemoved({ section: doc.sections[index]!, index });
    setExpanded(null);
    commit(doc.sections.filter((_, i) => i !== index));
  };

  const undoRemove = () => {
    if (!removed) return;
    const sections = [...doc.sections];
    sections.splice(removed.index, 0, removed.section);
    setRemoved(null);
    commit(sections);
  };

  const reset = () => {
    const parsed = parseSections(asLoaded.current);
    if (!parsed) return;
    setDoc(parsed);
    setRemoved(null);
    lastWritten.current = asLoaded.current;
    onChange(asLoaded.current);
  };

  const edited = assembleSections(doc) !== asLoaded.current;

  return (
    <section className="space-y-2 border-t border-rule pt-3">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <SectionHeader meta={`${doc.sections.length}${edited ? ' · edited' : ''}`}>
          Sections
        </SectionHeader>
        <span aria-hidden className="pl-2 font-mono text-xs text-muted">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="panel-enter space-y-2">
          <p className="text-xs text-muted">
            Reorder, rename or trim before tailoring. Drag a card, or use the arrows — both
            work, and the arrows work without a mouse.
          </p>

          <ul className="space-y-1.5">
            {doc.sections.map((section, index) => (
              <li
                key={section.id}
                draggable
                onDragStart={() => setDragging(index)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging !== null) move(dragging, index);
                  setDragging(null);
                }}
                className={`rounded border bg-paper px-2 py-1.5 transition-all duration-150 ${
                  dragging === index ? 'border-proof opacity-50' : 'border-rule'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className="cursor-grab select-none font-mono text-muted">
                    ⠿
                  </span>

                  <TextInput
                    value={section.title}
                    aria-label={`Section ${index + 1} title`}
                    onChange={(e) =>
                      commit(
                        doc.sections.map((s, i) =>
                          i === index ? retitleSection(s, e.target.value) : s,
                        ),
                      )
                    }
                    className="flex-1 border-transparent bg-transparent px-1 py-0.5 font-semibold"
                  />

                  <button
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${section.title} up`}
                    className="px-1 font-mono text-xs text-muted hover:text-proof disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => move(index, index + 1)}
                    disabled={index === doc.sections.length - 1}
                    aria-label={`Move ${section.title} down`}
                    className="px-1 font-mono text-xs text-muted hover:text-proof disabled:opacity-30"
                  >
                    ▼
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === section.id ? null : section.id)}
                    aria-label={`${expanded === section.id ? 'Hide' : 'Edit'} ${section.title} content`}
                    aria-expanded={expanded === section.id}
                    className="px-1 font-mono text-xs text-muted hover:text-proof"
                  >
                    {expanded === section.id ? '▾' : '▸'}
                  </button>
                  <button
                    onClick={() => remove(index)}
                    aria-label={`Remove ${section.title}`}
                    className="px-1 font-mono text-xs text-muted hover:text-cut"
                  >
                    ×
                  </button>
                </div>

                {expanded === section.id && (
                  <div className="panel-enter">
                    <TextArea
                      rows={8}
                      className="mt-1.5 font-mono"
                      aria-label={`${section.title} content`}
                      value={sectionBody(section)}
                      spellCheck={false}
                      onChange={(e) =>
                        commit(
                          doc.sections.map((s, i) =>
                            i === index ? replaceSectionBody(s, e.target.value) : s,
                          ),
                        )
                      }
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {removed && (
            <div className="flex items-center justify-between rounded-sm border-l-4 border-warn bg-warn-wash px-2.5 py-2 text-xs text-warn">
              <span>Removed “{removed.section.title}”.</span>
              <button onClick={undoRemove} className="font-mono font-semibold underline">
                undo
              </button>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => commit([...doc.sections, newSection(doc, 'New section')])}
            >
              Add section
            </Button>
            <Button variant="ghost" disabled={!edited} onClick={reset}>
              reset to as-loaded
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
