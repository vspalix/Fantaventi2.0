export function BusyLabel({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  if (!pending) return idle;
  return (
    <>
      <span className="spinner" aria-hidden="true" />
      {busy}
    </>
  );
}
