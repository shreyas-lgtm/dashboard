import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { GLOSSARY } from '../config';

/**
 * The "decoder ring" for Verizon vocabulary — the part of the site that makes
 * everything else make sense.
 */
export function Glossary() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={16} className="text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          What am I actually paying for?
        </h2>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Plain-language definitions of the Verizon terms that make the real site
        confusing.
      </p>

      <ul className="divide-y divide-gray-100">
        {GLOSSARY.map((entry, i) => {
          const isOpen = open === i;
          return (
            <li key={entry.term}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-3 py-3 text-left"
              >
                <span className="text-sm font-medium text-gray-800">
                  {entry.term}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 shrink-0 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isOpen && (
                <p className="pb-3 pr-6 text-sm leading-relaxed text-gray-600">
                  {entry.definition}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
