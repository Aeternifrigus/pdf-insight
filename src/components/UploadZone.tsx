import { useId, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n/context';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadZone({ onFile, disabled = false }: Props) {
  const { t } = useI18n();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <label
      htmlFor={inputId}
      className={`dropzone${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        aria-describedby={hintId}
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Pozwala wybrać ten sam plik ponownie.
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <svg className="dropzone-icon" viewBox="0 0 48 56" aria-hidden="true">
        <path d="M6 2h26l14 14v36a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
        <path d="M32 2v14h14" />
        <path className="dropzone-icon-mark" d="M12 30h24M12 37h24M12 44h14" />
      </svg>
      <span className="dropzone-title">{dragging ? t.upload.dragging : t.upload.title}</span>
      <span className="dropzone-action">{t.upload.action}</span>
      <span id={hintId} className="dropzone-hint">
        {t.upload.hint}
      </span>
    </label>
  );
}
