import type { JSX } from 'react';

type DocumentEditorProps = {
  value: string;
  connected: boolean;
  onChange(value: string): void;
};

export const DocumentEditor = ({
  value,
  connected,
  onChange,
}: DocumentEditorProps): JSX.Element => {
  return (
    <section className="document-shell" aria-labelledby="notes-title">
      <header className="notes-header">
        <div>
          <span className="eyebrow">Collaborate</span>
          <h2 id="notes-title">Shared notes</h2>
        </div>
        <span className={`notes-status ${connected ? 'is-ready' : ''}`} role="status">
          {connected ? 'Editing enabled' : 'Waiting for notes connection'}
        </span>
      </header>
      <p className="notes-description">A shared space for questions, ideas, and code snippets.</p>
      <textarea
        aria-label="Shared interview notes"
        aria-describedby="notes-help"
        className="document-page"
        value={value}
        readOnly={!connected}
        spellCheck
        placeholder={
          connected ? 'Type, paste, or edit the shared notes...' : 'Waiting for connection...'
        }
        onChange={(event) => {
          if (connected) {
            onChange(event.target.value);
          }
        }}
      />
      <footer className="notes-footer" id="notes-help">
        <span>
          {connected
            ? 'Both participants can edit these notes.'
            : 'Notes need a peer connection. Transcripts connect separately.'}
        </span>
        <span>{value.length.toLocaleString()} / 250,000</span>
      </footer>
    </section>
  );
};
