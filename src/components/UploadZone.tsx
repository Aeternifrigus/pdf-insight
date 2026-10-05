import { useId, useRef, useState, type DragEvent } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadZone({ onFile, disabled = false }: Props) {
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
      <span className="dropzone-title">
        {dragging ? 'Upuść plik, aby rozpocząć analizę' : 'Przeciągnij tutaj plik PDF'}
      </span>
      <span className="dropzone-action">albo wybierz go z dysku</span>
      <span id={hintId} className="dropzone-hint">
        PDF do 10 MB. Skany stron też zostaną odczytane. Treść pliku trafi do analizy w zewnętrznym
        API AI.
      </span>
    </label>
  );
}
