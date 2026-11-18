import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/** Hebrew dictation in the browser, where supported. `onText` gets each finished phrase. */
export function useDictation(onText: (said: string) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const handler = useRef(onText);
  handler.current = onText;
  const Speech = speechRecognition();

  useEffect(() => () => rec.current?.stop(), []);

  const toggle = () => {
    if (!Speech) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = 'he-IL';
    r.interimResults = false;
    r.continuous = true;
    let done = 0;
    r.onresult = (e) => {
      const results = Array.from(e.results);
      const said = results
        .slice(done)
        .map((res) => res[0]?.transcript ?? '')
        .join(' ')
        .trim();
      done = results.length;
      if (said) handler.current(said);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  };

  return { supported: Boolean(Speech), listening, toggle };
}

/** Appends dictated text to what is already typed */
export const appendText = (text: string, said: string) => `${text}${text && !text.endsWith(' ') ? ' ' : ''}${said}`.trim();
