export function MaintenanceBanner({ message, admin }: { message: string; admin: boolean }) {
  return (
    <div className={admin ? "maintenance-banner admin" : "maintenance-banner"} role="status">
      <strong>{admin ? "Manutenzione attiva per gli utenti" : "Manutenzione"}</strong>
      <p>{message}</p>
    </div>
  );
}
