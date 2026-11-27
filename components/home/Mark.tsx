export function Mark({ letter }: { letter: string }) {
  return <span className="face-mark" aria-hidden="true">{letter.slice(0, 1).toUpperCase()}</span>;
}
