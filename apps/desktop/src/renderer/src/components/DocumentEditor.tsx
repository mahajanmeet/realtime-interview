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
    <div className="document-shell">
      <textarea
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
    </div>
  );
};
